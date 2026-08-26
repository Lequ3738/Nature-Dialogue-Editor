import type { CommentBox, Edge, EdgeType, EditorState, FuncNodeType, Node, ViewState } from "./editorTypes";
import { characterNone, createInitialState } from "./editorTypes";

/**
 * 工程文件（.dialogue.json）子系统：工程文件是唯一权威数据源，
 * .gml 是由它导出的产物。序列化排除 view 等运行时状态，
 * 打开时视野由 fitViewToNodes 依据节点分布自适应计算。
 */

export const SCHEMA_VERSION = 1;

/** 工程文件固定字段顺序，保证 git diff 稳定 */
export function serializeProject(state: EditorState): string {
    const data = {
        schemaVersion: SCHEMA_VERSION,
        title: state.title,
        author: state.author,
        version: state.version,
        description: state.description,
        forbiddenExpression: state.forbiddenExpression,
        variables: state.variables,
        enableSnapToGrid: state.enableSnapToGrid,
        idCounter: state.idCounter,
        nodes: state.nodes,
        edges: state.edges,
        comments: state.comments,
    };
    return JSON.stringify(data, null, 2) + "\n";
}

const NODE_TYPES: FuncNodeType[] = ["node", "condition", "start", "end"];
const EDGE_TYPES: EdgeType[] = ["default", "true", "false"];

function asString(v: unknown, fallback = ""): string {
    return typeof v === "string" ? v : fallback;
}

function normalizeNode(n: any): Node | null {
    if (!n || typeof n !== "object") return null;
    if (typeof n.id !== "number" || typeof n.x !== "number" || typeof n.y !== "number") return null;
    const type: FuncNodeType = NODE_TYPES.includes(n.type) ? n.type : "node";
    return {
        id: n.id,
        type,
        x: n.x,
        y: n.y,
        cn: asString(n.cn),
        en: asString(n.en),
        code: asString(n.code),
        color: asString(n.color, "#7289da"),
        character:
            n.character && typeof n.character === "object"
                ? { ...characterNone, ...n.character }
                : characterNone,
    };
}

function normalizeEdge(e: any): Edge | null {
    if (!e || typeof e !== "object") return null;
    if (typeof e.fromId !== "number" || typeof e.toId !== "number") return null;
    return {
        fromId: e.fromId,
        toId: e.toId,
        type: EDGE_TYPES.includes(e.type) ? e.type : "default",
    };
}

function normalizeComment(c: any): CommentBox | null {
    if (!c || typeof c !== "object") return null;
    return {
        id: String(c.id ?? ""),
        x: typeof c.x === "number" ? c.x : 0,
        y: typeof c.y === "number" ? c.y : 0,
        w: typeof c.w === "number" ? c.w : 400,
        h: typeof c.h === "number" ? c.h : 300,
        text: asString(c.text, "区域注释"),
        color: asString(c.color, "#5865f2"),
    };
}

/**
 * 解析工程文件文本为编辑器状态。
 * view 不存盘也不恢复，返回默认值；调用方应随后用 fitViewToNodes 覆盖。
 */
export function deserializeProject(text: string): EditorState | null {
    // 容错：剥离外部编辑器可能加入的 BOM
    const cleaned = text.replace(/^\uFEFF/, "").trim();
    if (!cleaned) return null;

    let parsed: any;
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object") return null;

    // 只识别结构像工程文件的 JSON（必须至少有节点数组）
    if (!Array.isArray(parsed.nodes)) return null;

    const base = createInitialState();
    const nodes = parsed.nodes.map(normalizeNode).filter((n: Node | null): n is Node => n !== null);
    const edges = Array.isArray(parsed.edges)
        ? parsed.edges.map(normalizeEdge).filter((e: Edge | null): e is Edge => e !== null)
        : base.edges;
    const comments = Array.isArray(parsed.comments)
        ? parsed.comments.map(normalizeComment).filter((c: CommentBox | null): c is CommentBox => c !== null)
        : base.comments;

    const defaultView: ViewState = base.view;
    return {
        ...base,
        nodes,
        edges,
        comments,
        idCounter: typeof parsed.idCounter === "number" ? parsed.idCounter : base.idCounter,
        view: { ...defaultView },

        title: asString(parsed.title, base.title),
        description: asString(parsed.description, base.description),
        author: asString(parsed.author, base.author),
        version: asString(parsed.version, base.version),
        forbiddenExpression: asString(parsed.forbiddenExpression, base.forbiddenExpression),

        variables: Array.isArray(parsed.variables) ? parsed.variables : base.variables,
        enableSnapToGrid: typeof parsed.enableSnapToGrid === "boolean" ? parsed.enableSnapToGrid : base.enableSnapToGrid,
    };
}
