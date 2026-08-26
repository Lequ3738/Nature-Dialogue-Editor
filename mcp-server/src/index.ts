import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import type { EditorState } from "../../src/renderer/editorTypes";
import { deserializeProject, serializeProject } from "../../src/renderer/projectFile";
import { makeGml, parseGmlEditorData } from "../../src/renderer/editorLogic";
import {
    upsertNode, removeNodeCascade, disconnect, validateGraph, buildDialogue, applyConnect,
    type ValidationIssue,
} from "../../src/renderer/graphOps";

/**
 * Dialogue Editor 的 MCP server（stdio transport）。
 *
 * 设计约定：
 * - 无状态：每个工具都显式传工程文件路径
 * - 工程文件(.dialogue.json)是唯一权威；.gml 是导出产物，只在 export_gml 时写出
 * - 所有写操作与编辑器共享同一套逻辑（projectFile/graphOps/editorLogic），
 *   保证 Agent 产物与手工操作完全一致
 * - 禁止把 JSON 工程内容写回 .gml 路径（旧版迁移文件只读，需先另存为新格式）
 *
 * 注意：本进程走 stdio 协议，任何日志只能进 stderr。
 */

const VERSION = "1.0.0";

const server = new McpServer({
    name: "dialogue-editor",
    version: VERSION,
});

// ---------- 基础设施 ----------

class ToolError extends Error {}

function isLegacyPath(p: string): boolean {
    return /\.gml$/i.test(p);
}

function loadProject(p: string): EditorState {
    if (!fs.existsSync(p)) throw new ToolError(`文件不存在：${p}`);
    const text = fs.readFileSync(p, "utf-8");
    const project = deserializeProject(text);
    if (project) return project;
    const legacy = parseGmlEditorData(text);
    if (!legacy) throw new ToolError("无法解析：既不是 .dialogue.json 工程，也不含旧版 EDITOR_DATA 元数据");
    return legacy;
}

function assertMutable(p: string): void {
    if (isLegacyPath(p)) {
        throw new ToolError(`${path.basename(p)} 是旧版 .gml 工程，只读。请先用编辑器另存为 .dialogue.json 再修改`);
    }
}

function saveProject(p: string, state: EditorState): void {
    fs.writeFileSync(p, serializeProject(state), "utf-8");
}

/** 导出 GML 默认路径：工程文件旁、同名换扩展名 */
function pairedGmlPath(projectPath: string): string {
    const dir = path.dirname(projectPath);
    const base = path.basename(projectPath).replace(/\.dialogue\.json$/i, "").replace(/\.json$/i, "");
    return path.join(dir, `${base}.gml`);
}

function ok(payload: unknown) {
    return { content: [{ type: "text" as const, text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }] };
}

function fail(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text" as const, text: `错误：${message}` }], isError: true as const };
}

function issuesText(issues: ValidationIssue[]): string {
    if (issues.length === 0) return "校验通过，无问题";
    return issues.map((i) => `[${i.level}] ${i.message}`).join("\n");
}

// ---------- 工具注册 ----------

server.tool(
    "project_info",
    "读取对话工程概览：元数据、各类节点统计、变量列表与结构校验结果",
    { path: z.string().describe("工程文件绝对路径（.dialogue.json 或旧版 .gml）") },
    ({ path }) => {
        try {
            const s = loadProject(path);
            const byType = { node: 0, condition: 0, start: 0, end: 0 } as Record<string, number>;
            for (const n of s.nodes) byType[n.type] = (byType[n.type] ?? 0) + 1;
            const issues = validateGraph(s);
            return ok({
                title: s.title, author: s.author, version: s.version, description: s.description,
                forbiddenExpression: s.forbiddenExpression,
                idCounter: s.idCounter,
                nodes: byType, comments: s.comments.length, edges: s.edges.length,
                variables: s.variables.map((v) => ({ name: v.name, value: v.value, persistent: v.persistent })),
                characters: [...new Set(s.nodes.map((n) => n.character?.constantName).filter(Boolean))],
                validationIssues: issues,
            });
        } catch (err) { return fail(err); }
    }
);

server.tool(
    "list_nodes",
    "列出工程中的全部节点与连线",
    {
        path: z.string().describe("工程文件路径"),
        includeEdges: z.boolean().optional().default(true).describe("是否附带连线表（默认附带）"),
    },
    ({ path, includeEdges }) => {
        try {
            const s = loadProject(path);
            return ok({
                nodes: s.nodes.map((n) => ({
                    id: n.id, type: n.type,
                    cn: n.cn, en: n.en,
                    code: n.code || undefined,
                    character: n.character?.constantName,
                    x: n.x, y: n.y,
                })),
                edges: includeEdges ? s.edges : undefined,
                idCounter: s.idCounter,
            });
        } catch (err) { return fail(err); }
    }
);

const upsertShape = {
    path: z.string().describe("工程文件路径"),
    id: z.number().optional().describe("要更新的节点 id；省略表示新建"),
    type: z.enum(["node", "condition", "start", "end"]).optional().describe("节点类型（新建必填）"),
    cn: z.string().optional().describe("中文文本"),
    en: z.string().optional().describe("英文文本"),
    code: z.string().optional().describe("节点执行代码（GML，this 指代说话角色）"),
    color: z.string().optional().describe("节点颜色 #rrggbb"),
    characterConstantName: z.string().optional().describe("说话角色常量名（如 npc_haming）；未知常量会自动登记新角色"),
    x: z.number().optional().describe("画布坐标 x（省略则自动布局）"),
    y: z.number().optional().describe("画布坐标 y"),
    nearId: z.number().optional().describe("自动布局的参照节点 id，新节点放在它附近"),
};

server.tool(
    "upsert_node",
    "新建或更新一个节点。新建时自动分配 id 与画布位置；更新时只修改提供的字段",
    upsertShape,
    (input) => {
        try {
            assertMutable(input.path);
            const s = loadProject(input.path);
            const result = upsertNode(s, input);
            saveProject(input.path, result.state);
            const createdIssues = validateGraph(result.state).filter(
                (i) => i.message.includes(`#${result.nodeId}`)
            );
            return ok({ nodeId: result.nodeId, created: result.created, totalNodes: result.state.nodes.length, issuesForThisNode: createdIssues });
        } catch (err) { return fail(err); }
    }
);

server.tool(
    "remove_node",
    "删除节点并级联清理其所有连线",
    {
        path: z.string().describe("工程文件路径"),
        id: z.number().describe("要删除的节点 id"),
    },
    ({ path, id }) => {
        try {
            assertMutable(path);
            const s = loadProject(path);
            const result = removeNodeCascade(s, id);
            if (!result.removedNode) return fail(`节点 #${id} 不存在`);
            saveProject(path, result.state);
            return ok({ removedNode: result.removedNode, removedEdges: result.removedEdges, totalNodes: result.state.nodes.length });
        } catch (err) { return fail(err); }
    }
);

server.tool(
    "connect",
    "在两个节点之间建立连线。type=true/false 仅用于条件节点；同一条件节点的同类型边会被覆盖",
    {
        path: z.string().describe("工程文件路径"),
        fromId: z.number(),
        toId: z.number(),
        type: z.enum(["default", "true", "false"]).optional().default("default"),
    },
    ({ path, fromId, toId, type }) => {
        try {
            assertMutable(path);
            const s = loadProject(path);
            const result = applyConnect(s, fromId, toId, type);
            saveProject(path, result.state);
            return ok({ connected: result.changed, fromId, toId, type });
        } catch (err) { return fail(err); }
    }
);

server.tool(
    "disconnect",
    "断开两点之间的连线；type 省略时删除所有类型",
    {
        path: z.string().describe("工程文件路径"),
        fromId: z.number(),
        toId: z.number(),
        type: z.enum(["default", "true", "false"]).optional(),
    },
    ({ path, fromId, toId, type }) => {
        try {
            assertMutable(path);
            const s = loadProject(path);
            const result = disconnect(s, fromId, toId, type);
            saveProject(path, result.state);
            return ok({ removed: result.removed });
        } catch (err) { return fail(err); }
    }
);

server.tool(
    "validate_graph",
    "校验图结构：悬空边、开始节点问题、不可达节点、条件分支缺失、空文本、死路等",
    { path: z.string().describe("工程文件路径") },
    ({ path }) => {
        try {
            const s = loadProject(path);
            const issues = validateGraph(s);
            return ok({ passed: issues.every((i) => i.level !== "error"), issues });
        } catch (err) { return fail(err); }
    }
);

server.tool(
    "export_gml",
    "由工程文件生成引擎使用的 .gml 文件（与编辑器内导出完全一致）",
    {
        path: z.string().describe("工程文件路径"),
        gmlPath: z.string().optional().describe("输出 .gml 路径；省略时写到工程文件旁同名文件"),
    },
    ({ path, gmlPath }) => {
        try {
            const s = loadProject(path);
            const target = gmlPath ?? pairedGmlPath(path);
            fs.writeFileSync(target, makeGml(s), "utf-8");
            return ok({ exportedTo: target });
        } catch (err) { return fail(err); }
    }
);

const specNodeSchema = z.object({
    key: z.string().optional().describe("本地键名，供 edges 引用；省略时用数组下标"),
    type: z.enum(["node", "condition", "start", "end"]).optional().describe("默认 node"),
    cn: z.string().optional(),
    en: z.string().optional(),
    code: z.string().optional(),
    characterConstantName: z.string().optional(),
});

server.tool(
    "build_dialogue",
    "一次性构建一段对话子图：批量建节点、自动布局、按声明式边表连线并返回校验结果。edges 的 from/to 引用节点的 key 或数组下标",
    {
        path: z.string().describe("工程文件路径"),
        nearId: z.number().optional().describe("新子图围绕哪个现有节点布局"),
        nodes: z.array(specNodeSchema).min(1).describe("节点列表"),
        edges: z.array(z.object({
            from: z.union([z.string(), z.number()]),
            to: z.union([z.string(), z.number()]),
            type: z.enum(["default", "true", "false"]).optional().default("default"),
        })).describe("边表"),
    },
    ({ path, nearId, nodes, edges }) => {
        try {
            assertMutable(path);
            const s = loadProject(path);
            const result = buildDialogue(s, { nearId, nodes, edges });
            saveProject(path, result.state);
            return ok({ ids: result.ids, keyToId: result.keyToId, totalNodes: result.state.nodes.length, issuesForNewNodes: result.issues });
        } catch (err) { return fail(err); }
    }
);

// ---------- 启动 ----------

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`dialogue-editor MCP server v${VERSION} ready (stdio)`);
}

main().catch((err) => {
    console.error("fatal:", err);
    process.exit(1);
});
