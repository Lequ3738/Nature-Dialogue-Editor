import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { deserializeProject, serializeProject } from "../../src/renderer/projectFile";
import { makeGml, parseGmlEditorData } from "../../src/renderer/editorLogic";
import { canConnect, applyConnect } from "../../src/renderer/editorLogic";
import { upsertNode, removeNodeCascade, disconnect, validateGraph, buildDialogue, upsertVariable, removeVariable } from "../../src/renderer/graphOps";
import { createInitialState, type EditorState } from "../../src/renderer/editorTypes";

let failed = 0;
function check(name: string, cond: boolean) {
    console.log(`${cond ? "PASS" : "FAIL"} - ${name}`);
    if (!cond) failed++;
}

const noChar = { id: "SPEC001", name: "无角色", constantName: "npc_noone", remark: "" };
function mkNode(id: number, type: EditorState["nodes"][number]["type"], x = 0, y = 0, cn = "") {
    return { id, type, x, y, cn, en: "", code: "", color: "#7289da", character: noChar, tag: "" };
}

// ========== 1. 黄金文件回归：真实工程 迁移→序列化→导出 全链路 ==========

const fixturePath = path.join(__dirname, "..", "testdata", "dlgEveningHaming.gml");
const raw = fs.readFileSync(fixturePath, "utf-8");
{
    const state = parseGmlEditorData(raw);
    check("黄金：旧 .gml 可解析", state !== null);
    if (state) {
        // 期望输出 = 生成头注释 + （旧文件去时间戳行、去 EDITOR_DATA 尾巴、统一 LF）
        const header =
            "// =============================================\n" +
            "// 本文件由「对话编辑器」自动生成，请勿手动修改！\n" +
            "// 请修改对应的对话工程文件后重新导出。\n" +
            "// =============================================\n\n";
        const oldNormalized = raw
            .replace(/^\/\/ 最后修改时间:.*\r?\n/m, "")
            .replace(/\n*\/\* EDITOR_DATA:[\s\S]*$/, "")
            .replace(/\r\n/g, "\n")
            .trimEnd();
        const exported = makeGml(state);
        check(`黄金：makeGml 与编辑器实际导出逐字节一致（${exported.length} 字符）`, exported.trimEnd() === (header + oldNormalized).trimEnd());

        // 再走一遍 JSON 序列化往返，导出仍须一致
        const roundTrip = deserializeProject(serializeProject(state));
        check("黄金：JSON 往返后导出仍一致", roundTrip !== null && makeGml(roundTrip) === exported);
    }
}

// ========== 2. 连线规则 ==========

function baseState(): EditorState {
    const s = createInitialState();
    s.nodes.push(
        mkNode(1, "start", 0, 0),
        mkNode(2, "node", 400, 0),
        mkNode(3, "condition", 800, 0),
        mkNode(4, "end", 1200, 0),
    );
    s.idCounter = 5;
    return s;
}

{
    const s = baseState();
    check("规则：自身连线被拒", !canConnect(s, 2, 2).ok);
    check("规则：结束节点不能外连", !canConnect(s, 4, 2).ok);
    check("规则：对话节点连入开始节点被拒", !canConnect(s, 2, 1).ok);
    check("规则：条件节点可以连入开始节点", canConnect(s, 3, 1).ok);

    // 条件节点 true 边覆盖
    let s2 = applyConnect(s, 3, 2, "true").state;
    s2 = applyConnect(s2, 3, 4, "true").state;
    check("规则：条件 true 边覆盖旧的", s2.edges.filter((e) => e.fromId === 3 && e.type === "true").length === 1 && s2.edges[0].toId === 4);
    // default 不覆盖——但开始节点例外：开始节点的同类型出边仍然覆盖（与原 UI 行为一致）
    let s3 = applyConnect(s, 1, 2, "default").state;
    s3 = applyConnect(s3, 1, 4, "default").state;
    check("规则：开始节点 default 出边同类型覆盖", s3.edges.filter((e) => e.fromId === 1).length === 1 && s3.edges[0].toId === 4);
    // 普通节点多条 default 共存，断开其中一条
    let s4 = applyConnect(s, 2, 3, "default").state;
    s4 = applyConnect(s4, 2, 4, "default").state;
    const d = disconnect(s4, 2, 3);
    check("规则：disconnect 删除指定边", d.removed === 1 && d.state.edges.some((e) => e.fromId === 2 && e.toId === 4));
}

// ========== 3. upsert / remove ==========

{
    const s = baseState();
    const r1 = upsertNode(s, { type: "node", cn: "甲", characterConstantName: "npc_haming" });
    check("upsert：新建分配递增 id", r1.created && r1.nodeId === 5);
    check("upsert：角色常量已登记", r1.state.nodes.find((n) => n.id === 5)?.character.constantName === "npc_haming");

    const r2 = upsertNode(r1.state, { id: 5, cn: "甲改", code: "x = 1" });
    const n5 = r2.state.nodes.find((n) => n.id === 5)!;
    check("upsert：更新只改提供的字段", n5.cn === "甲改" && n5.code === "x = 1" && n5.character.constantName === "npc_haming");

    const r3 = removeNodeCascade(r2.state, 5);
    check("remove：级联清理", r3.removedNode !== null && r3.removedEdges === 0 && r3.state.nodes.length === 4);
}

// ========== 4. buildDialogue + validateGraph ==========

{
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dlg-mcp-test-"));
    try {
        const projPath = path.join(tmpDir, "test.dialogue.json");
        let s = createInitialState();

        // 用 spec 建一段小对话：start → 甲 → 条件 →(true) 乙 → end；(false) 丙
        const built = buildDialogue(s, {
            nodes: [
                { key: "st", type: "start" },
                { key: "a", cn: "你好", characterConstantName: "npc_a" },
                { key: "cnd", type: "condition" },
                { key: "b", cn: "分支一", characterConstantName: "npc_b" },
                { key: "c", cn: "分支二" },
                { key: "ed", type: "end" },
            ],
            edges: [
                { from: "st", to: "a" },
                { from: "a", to: "cnd" },
                { from: "cnd", to: "b", type: "true" },
                { from: "cnd", to: "c", type: "false" },
                { from: "b", to: "ed" },
            ],
        });
        s = built.state;
        check("build：全部节点创建", built.ids.length === 6 && s.nodes.length === 6);
        check("build：key 映射正确", built.keyToId["a"] === built.ids[1]);
        check("build：新子图校验通过", built.issues.every((i) => i.level !== "error"));

        // 写盘 → 读回 → 校验 → 导出
        fs.writeFileSync(projPath, serializeProject(s));
        const loaded = deserializeProject(fs.readFileSync(projPath, "utf-8"))!;
        check("build：落盘往返无损", loaded!.nodes.length === 6 && loaded.edges.length === 5);
        const issues = validateGraph(loaded);
        check("validate：完整对话无 error", issues.every((i) => i.level !== "error"));
        const gml = makeGml(loaded);
        check("build：导出含条件分支与选择枝", gml.includes("if (") && gml.includes("ds_graph_edge_add"));

        // 破坏性结构检测
        let broken = createInitialState();
        broken.nodes.push(mkNode(1, "start"), mkNode(2, "node"), mkNode(3, "node"));
        broken.nodes.push(mkNode(9, "start"));
        broken.edges.push({ fromId: 2, toId: 99, type: "default" });
        const bIssues = validateGraph(broken);
        const msgs = bIssues.map((i) => i.message).join("|");
        check("validate：多个 start 被发现", msgs.includes("2 个开始节点"));
        check("validate：悬空边被发现", msgs.includes("悬空"));
        check("validate：不可达被发现", msgs.includes("不可达"));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

// ========== 5. 节点标记 → GML ==========

{
    const s = baseState();
    const r = upsertNode(s, { id: 2, tag: "welcome" });
    const gml = makeGml(r.state);
    check("标记：///welcome 出现在代码块首行", gml.includes("ds_graph_node_add(_graph, '\n    ///welcome\n"));
    const r2 = upsertNode(r.state, { id: 2, tag: "" });
    check("标记：清空后无 /// 行", !makeGml(r2.state).includes("///"));
    const built = buildDialogue(createInitialState(), {
        nodes: [{ cn: "x", tag: "village" }],
        edges: [],
    });
    check("标记：buildDialogue 透传 tag", makeGml(built.state).includes("    ///village\n"));
    // 工程文件往返保留 tag
    const roundTrip = deserializeProject(serializeProject(r.state))!;
    check("标记：JSON 往返保留 tag", roundTrip.nodes.find((n) => n.id === 2)?.tag === "welcome");
}

// ========== 6. 自定义变量 ==========

{
    let s = createInitialState();
    const r1 = upsertVariable(s, { name: "eventDialogNothing", value: 1 });
    check("变量：新建 number 类型", r1.created && r1.variable.type === "number" && r1.variable.value === 1);
    check("变量：默认不持久化", r1.variable.persistent === false);
    const r2 = upsertVariable(r1.state, { name: "eventDialogNothing", persistent: true, value: 3 });
    check("变量：同名更新", !r2.created && r2.state.variables.length === 1 && r2.variable.persistent === true && r2.variable.value === 3);
    const r3 = upsertVariable(r2.state, { name: "greeting", value: "你好", type: "string" });
    check("变量：字符串类型", r3.variable.type === "string" && r3.variable.value === "你好");
    const r4 = upsertVariable(r3.state, { name: "num", value: "42" });
    check("变量：数字值字符串自动按 string 推断", r4.variable.type === "string" && r4.variable.value === "42");
    const r5 = upsertVariable(r4.state, { name: "num", value: 7, type: "number" });
    check("变量：类型切换自动转换", r5.variable.type === "number" && r5.variable.value === 7);

    // 非法名/空名
    let threw = false;
    try { upsertVariable(r5.state, { name: "1bad" }); } catch { threw = true; }
    check("变量：非法标识符被拒", threw);

    // 校验：重名与非法名
    const dup = upsertVariable(r5.state, { name: "num", value: 1 });
    const dupIssues = validateGraph({ ...dup.state, variables: [...dup.state.variables, { ...dup.variable, id: "x" }] });
    check("变量：重名被校验捕获", dupIssues.some((i) => i.message.includes("重复定义")));
    const badNameIssues = validateGraph({ ...dup.state, variables: [{ id: "a", name: "bad-name", value: 0, type: "number", persistent: false }] });
    check("变量：非法名被校验捕获", badNameIssues.some((i) => i.message.includes("不是合法的 GML 标识符")));

    // 导出与序列化
    const gml = makeGml(r2.state);
    check("变量：persistent 导出 scrDefault", gml.includes('scrDefault("eventDialogNothing", 3)'));
    const gml2 = makeGml(r5.state);
    check("变量：非持久化导出直接赋值", gml2.includes("greeting = \"你好\";") && gml2.includes("num = 7;"));
    const rt = deserializeProject(serializeProject(r5.state))!;
    check("变量：JSON 往返保留", rt.variables.length === 3 && rt.variables.some((v) => v.name === "eventDialogNothing" && v.persistent === true));

    // 删除
    const rm = removeVariable(r5.state, "greeting");
    check("变量：按名删除", rm.removed === 1 && !rm.state.variables.some((v) => v.name === "greeting"));
}

console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
