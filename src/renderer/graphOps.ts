import type { EditorState, EdgeType, FuncNodeType, Node } from "./editorTypes";
import { characterNone } from "./editorTypes";
import { applyConnect, canConnect, findFreeNodePosition, snapToGrid, GRID_SIZE, type ConnectCheck } from "./editorLogic";

/**
 * 共享图操作层：编辑器 UI 与 MCP server 共用的纯函数操作。
 * 连线规则（canConnect/applyConnect）定义在 editorLogic.ts 并被画布交互复用，
 * 这里只做更高层的组合操作。
 */

export type { ConnectCheck };
export { canConnect, applyConnect };

/** 断开连线；type 省略时删除两点间所有类型的连线。返回删除条数。 */
export function disconnect(state: EditorState, fromId: number, toId: number, type?: EdgeType): {
    state: EditorState; removed: number;
} {
    const before = state.edges.length;
    const edges = state.edges.filter(
        (e) => !(e.fromId === fromId && e.toId === toId && (type === undefined || e.type === type))
    );
    return { state: { ...state, edges }, removed: before - edges.length };
}

/** 在指定锚点附近找一个不重叠的空位（网格吸附） */
function placeNode(state: EditorState, nearX: number, nearY: number): { x: number; y: number } {
    return findFreeNodePosition(nearX, nearY, state.nodes, true);
}

/** 所有已知角色的常量名 → Character 映射（从现有节点收集） */
export function collectCharacters(state: EditorState): Map<string, Node["character"]> {
    const map = new Map<string, Node["character"]>();
    for (const n of state.nodes) {
        if (n.character?.constantName && !map.has(n.character.constantName)) {
            map.set(n.character.constantName, n.character);
        }
    }
    return map;
}

/** 解析角色：优先复用工程里已有的同常量名角色对象，否则按常量名新建 */
export function resolveCharacter(state: EditorState, constantName: string): Node["character"] {
    const known = collectCharacters(state).get(constantName);
    if (known) return known;
    if (constantName === characterNone.constantName) return characterNone;
    return { id: `MCP_${constantName}`, name: constantName, constantName, remark: "" };
}

export interface UpsertNodeInput {
    /** 省略 = 新建；提供 = 更新对应节点（不存在则报错） */
    id?: number;
    /** 新建时必填；更新时可省略表示不变 */
    type?: FuncNodeType;
    cn?: string;
    en?: string;
    code?: string;
    color?: string;
    /** 节点标记（仅对话节点用，导出为 /// 注释） */
    tag?: string;
    characterConstantName?: string;
    /** 位置；省略时自动找空位 */
    x?: number;
    y?: number;
    /** 自动布局时的参照节点，新节点会放在它附近 */
    nearId?: number;
}

/** 新建或更新节点。返回更新后的 state 与节点 id。 */
export function upsertNode(state: EditorState, input: UpsertNodeInput): {
    state: EditorState; nodeId: number; created: boolean;
} {
    if (input.id !== undefined) {
        const idx = state.nodes.findIndex((n) => n.id === input.id);
        if (idx === -1) throw new Error(`节点 #${input.id} 不存在`);
        const old = state.nodes[idx];
        const next: Node = {
            ...old,
            type: input.type ?? old.type,
            cn: input.cn ?? old.cn,
            en: input.en ?? old.en,
            code: input.code ?? old.code,
            color: input.color ?? old.color,
            tag: input.tag ?? old.tag ?? "",
            character: input.characterConstantName
                ? resolveCharacter(state, input.characterConstantName)
                : old.character,
        };
        if (input.x !== undefined || input.y !== undefined) {
            next.x = input.x ?? next.x;
            next.y = input.y ?? next.y;
        }
        const nodes = [...state.nodes];
        nodes[idx] = next;
        return { state: { ...state, nodes }, nodeId: next.id, created: false };
    }

    if (!input.type) throw new Error("新建节点必须提供 type");
    const anchor = state.nodes.find((n) => n.id === input.nearId);
    const basePos = anchor
        ? { x: anchor.x, y: anchor.y + GRID_SIZE * 3 }
        : centroidOfNodes(state.nodes);
    const pos = input.x !== undefined && input.y !== undefined
        ? { x: snapToGrid(input.x, true), y: snapToGrid(input.y, true) }
        : placeNode(state, basePos.x, basePos.y);

    const id = state.idCounter;
    const node: Node = {
        id,
        type: input.type,
        x: pos.x,
        y: pos.y,
        cn: input.cn ?? "",
        en: input.en ?? "",
        code: input.code ?? "",
        color: input.color ?? "#7289da",
        tag: input.tag ?? "",
        character: resolveCharacter(state, input.characterConstantName ?? characterNone.constantName),
    };
    return {
        state: { ...state, nodes: [...state.nodes, node], idCounter: id + 1 },
        nodeId: id,
        created: true,
    };
}

function centroidOfNodes(nodes: Node[]): { x: number; y: number } {
    if (nodes.length === 0) return { x: 500, y: 500 };
    const sum = nodes.reduce((acc, n) => ({ x: acc.x + n.x, y: acc.y + n.y }), { x: 0, y: 0 });
    return { x: sum.x / nodes.length, y: sum.y / nodes.length };
}

/** 删除节点并级联清理其所有连线。返回被删节点的信息。 */
export function removeNodeCascade(state: EditorState, nodeId: number): {
    state: EditorState; removedNode: Node | null; removedEdges: number;
} {
    const removedNode = state.nodes.find((n) => n.id === nodeId) ?? null;
    if (!removedNode) return { state, removedNode: null, removedEdges: 0 };
    const nodes = state.nodes.filter((n) => n.id !== nodeId);
    const before = state.edges.length;
    const edges = state.edges.filter((e) => e.fromId !== nodeId && e.toId !== nodeId);
    return {
        state: { ...state, nodes, edges },
        removedNode,
        removedEdges: before - edges.length,
    };
}

export interface ValidationIssue {
    level: "error" | "warning";
    message: string;
}

/** 图结构校验：错误会导致生成代码不符合预期，警告为可运行但可疑的结构 */
export function validateGraph(state: EditorState): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const funcNodes = state.nodes;

    // 悬空边
    const ids = new Set(funcNodes.map((n) => n.id));
    for (const e of state.edges) {
        if (!ids.has(e.fromId) || !ids.has(e.toId)) {
            issues.push({ level: "error", message: `悬空连线：#${e.fromId} → #${e.toId}（端点不存在，生成时会被静默丢弃）` });
        }
    }

    const starts = funcNodes.filter((n) => n.type === "start");
    if (funcNodes.length > 0 && starts.length === 0) {
        issues.push({ level: "error", message: "缺少开始节点" });
    }
    if (starts.length > 1) {
        issues.push({ level: "error", message: `存在 ${starts.length} 个开始节点（#${starts.map((n) => n.id).join("、#")}），生成时只有第一个生效` });
    }

    // 可达性（忽略边类型，从开始节点 BFS）
    const reachable = new Set<number>();
    if (starts.length > 0) {
        const queue = [starts[0].id];
        reachable.add(starts[0].id);
        while (queue.length > 0) {
            const cur = queue.shift()!;
            for (const e of state.edges) {
                if (e.fromId === cur && !reachable.has(e.toId)) {
                    reachable.add(e.toId);
                    queue.push(e.toId);
                }
            }
        }
        for (const n of funcNodes) {
            if (!reachable.has(n.id)) {
                issues.push({ level: "warning", message: `节点 #${n.id}（${nodeLabel(n)}）从开始节点不可达` });
            }
        }
    }

    // 开始节点必须有出边
    for (const s of starts) {
        const out = state.edges.some((e) => e.fromId === s.id);
        if (!out) issues.push({ level: "error", message: "开始节点没有任何出边，对话无法启动" });
    }

    // 条件节点分支完整性
    for (const c of funcNodes.filter((n) => n.type === "condition")) {
        const hasTrue = state.edges.some((e) => e.fromId === c.id && e.type === "true");
        const hasFalse = state.edges.some((e) => e.fromId === c.id && e.type === "false");
        if (!hasTrue && !hasFalse) {
            issues.push({ level: "warning", message: `条件节点 #${c.id} 没有任何分支连线` });
        } else if (!hasTrue) {
            issues.push({ level: "warning", message: `条件节点 #${c.id} 缺少 true 分支（生成的 if 为空体）` });
        } else if (!hasFalse) {
            issues.push({ level: "warning", message: `条件节点 #${c.id} 缺少 false 分支（else 为空）` });
        }
    }

    // 空文本的对话节点
    for (const n of funcNodes.filter((n) => n.type === "node")) {
        if (!n.cn.trim() && !n.en.trim()) {
            issues.push({ level: "warning", message: `对话节点 #${n.id} 中英文内容均为空` });
        }
    }

    // 死路：无出边的对话节点，且不是任何结束节点的有效父辈 → 对话无法结束
    const endIds = new Set(funcNodes.filter((n) => n.type === "end").map((n) => n.id));
    if (endIds.size > 0) {
        const effectiveEndParents = new Set<number>();
        for (const endId of endIds) {
            collectEffectiveParents(state, endId, effectiveEndParents, new Set());
        }
        for (const n of funcNodes.filter((n) => n.type === "node")) {
            const hasOut = state.edges.some((e) => e.fromId === n.id);
            if (!hasOut && !effectiveEndParents.has(n.id)) {
                issues.push({ level: "warning", message: `对话节点 #${n.id}（${nodeLabel(n)}）没有后继也不邻接结束节点，对话会卡在这里` });
            }
        }
    }

    return issues;
}

function nodeLabel(n: Node): string {
    const text = n.cn || n.en;
    return text ? `"${text.slice(0, 12)}"` : "无标题";
}

/** 找到指向 nodeId 的所有"有效对话父辈"（穿透条件/开始节点），与 makeGml 的结束逻辑一致 */
function collectEffectiveParents(state: EditorState, nodeId: number, out: Set<number>, visited: Set<number>) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    for (const e of state.edges.filter((e) => e.toId === nodeId)) {
        const p = state.nodes.find((n) => n.id === e.fromId);
        if (!p) continue;
        if (p.type === "node") {
            out.add(p.id);
        } else {
            collectEffectiveParents(state, p.id, out, visited);
        }
    }
}

export interface DialogueSpecNode {
    /** 可选的本地键，供 edges 引用；省略时用数组下标引用 */
    key?: string;
    type?: FuncNodeType;
    cn?: string;
    en?: string;
    code?: string;
    /** 节点标记（仅对话节点用，导出为 /// 注释） */
    tag?: string;
    characterConstantName?: string;
}

export interface DialogueSpecEdge {
    from: string | number;
    to: string | number;
    type?: EdgeType;
}

export interface BuildDialogueSpec {
    /** 新节点围绕哪个现有节点布局 */
    nearId?: number;
    nodes: DialogueSpecNode[];
    edges: DialogueSpecEdge[];
}

/**
 * 一次性构建一段对话子图：统一分配 id、自动布局、建边并跑校验。
 * 节点引用规则：edges 的 from/to 可以是 spec 节点的 key 或下标（数字=下标）。
 * 返回新 state、分配的 id 列表与校验问题。
 */
export function buildDialogue(state: EditorState, spec: BuildDialogueSpec): {
    state: EditorState; ids: number[]; keyToId: Record<string, number>; issues: ValidationIssue[];
} {
    if (!Array.isArray(spec.nodes) || spec.nodes.length === 0) {
        throw new Error("spec.nodes 不能为空");
    }

    let next = state;
    const ids: number[] = [];
    const keyToId: Record<string, number> = {};
    const indexToKey: (string | undefined)[] = [];

    spec.nodes.forEach((sn, i) => {
        const result = upsertNode(next, {
            type: sn.type ?? "node",
            cn: sn.cn,
            en: sn.en,
            code: sn.code,
            tag: sn.tag,
            characterConstantName: sn.characterConstantName,
            nearId: spec.nearId,
        });
        next = result.state;
        ids.push(result.nodeId);
        indexToKey[i] = sn.key;
        if (sn.key !== undefined) {
            if (keyToId[sn.key] !== undefined) throw new Error(`spec 节点 key 重复："${sn.key}"`);
            keyToId[sn.key] = result.nodeId;
        }
    });

    const resolveRef = (ref: string | number): number => {
        if (typeof ref === "number") {
            if (ref < 0 || ref >= ids.length) throw new Error(`spec 边引用下标越界：${ref}`);
            return ids[ref];
        }
        if (keyToId[ref] === undefined) throw new Error(`spec 边引用了不存在的 key："${ref}"`);
        return keyToId[ref];
    };

    for (const se of spec.edges) {
        const from = resolveRef(se.from);
        const to = resolveRef(se.to);
        const check = canConnect(next, from, to);
        if (!check.ok) throw new Error(`建边失败（#${from} → #${to}）：${check.reason}`);
        next = applyConnect(next, from, to, se.type ?? "default").state;
    }

    return { state: next, ids, keyToId, issues: validateGraphDiff(next, state) };
}

/** 只报告新增节点相关的校验问题，避免历史问题淹没本次结果 */
function validateGraphDiff(after: EditorState, before: EditorState): ValidationIssue[] {
    const beforeKeys = new Set(before.nodes.map((n) => n.id));
    const all = validateGraph(after);
    const newNodeIssues = all.filter((i) => {
        const m = i.message.match(/#(\d+)/g);
        if (!m) return false;
        return m.some((s) => {
            const id = Number(s.slice(1));
            return !beforeKeys.has(id);
        });
    });
    return newNodeIssues.length > 0 ? newNodeIssues : [];
}
