import type { CommentBox, Edge, EdgeType, EditorState, Node } from "./editorTypes";
import { createInitialState } from "./editorTypes";

const NODE_WIDTH = 260;
const NODE_HEIGHT = 120;
const NODE_GAP = 40;

function isNodeOverlapped(candidateX: number, candidateY: number, nodes: Node[]): boolean {
    return nodes.some((n) => {
        const noOverlap =
            candidateX + NODE_WIDTH + NODE_GAP < n.x ||
            n.x + NODE_WIDTH + NODE_GAP < candidateX ||
            candidateY + NODE_HEIGHT + NODE_GAP < n.y ||
            n.y + NODE_HEIGHT + NODE_GAP < candidateY;
        return !noOverlap;
    });
}

function findFreeNodePosition(
    centerX: number,
    centerY: number,
    nodes: Node[]
): { x: number; y: number } {
    if (!isNodeOverlapped(centerX, centerY, nodes)) {
        return { x: centerX, y: centerY };
    }

    const step = 60;
    const maxRadius = 1200;

    for (let radius = step; radius <= maxRadius; radius += step) {
        const points = Math.max(8, Math.floor((Math.PI * 2 * radius) / step));
        for (let i = 0; i < points; i += 1) {
            const angle = (Math.PI * 2 * i) / points;
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;
            if (!isNodeOverlapped(x, y, nodes)) {
                return { x, y };
            }
        }
    }

    return { x: centerX, y: centerY };
}

export function hasEdge(state: EditorState, fromId: number, type: EdgeType): boolean {
    return state.edges.some((e) => e.fromId === fromId && e.type === type);
}

export function addObject(
    state: EditorState,
    type: "comment" | "node" | "condition",
    viewportWidth: number,
    viewportHeight: number
): EditorState {
    const center = {
        x: (viewportWidth / 2 - state.view.x) / state.view.zoom,
        y: (viewportHeight / 2 - state.view.y) / state.view.zoom,
    };

    if (type === "comment") {
        const nextId = state.idCounter;
        const next: CommentBox = {
            id: "c" + nextId,
            x: center.x,
            y: center.y,
            w: 400,
            h: 300,
            text: "区域注释",
            color: "#3baa71",
        };
        return { ...state, comments: [...state.comments, next], idCounter: state.idCounter + 1 };
    }

    const nextId = state.idCounter;
    const placed = findFreeNodePosition(center.x, center.y, state.nodes);
    const next: Node = {
        id: nextId,
        type: type,
        x: placed.x,
        y: placed.y,
        cn: "",
        en: "",
        code: "",
        color: type === "condition" ? "#e67e22" : "#7289da",
    };
    return { ...state, nodes: [...state.nodes, next], idCounter: state.idCounter + 1 };
}

export function startConnect(
    state: EditorState,
    destinationNodeId: number,
    portType: EdgeType
): EditorState {
    if (!state.connecting) {
        return { ...state, connecting: { fromId: destinationNodeId, type: portType } };
    }

    const { fromId, type } = state.connecting;
    if (fromId !== destinationNodeId) {
        // 条件节点：true/false 各只能有一条（覆盖旧的同类型连线）
        // 普通节点：default 允许多条（不覆盖）
        let nextEdges: Edge[] = state.edges;
        if (type === "true" || type === "false") {
            nextEdges = nextEdges.filter((edge) => !(edge.fromId === fromId && edge.type === type));
        }

        // 防止重复添加同一条连线
        const exists = nextEdges.some(
            (e) => e.fromId === fromId && e.toId === destinationNodeId && e.type === type
        );
        if (!exists) {
            nextEdges = [...nextEdges, { fromId, toId: destinationNodeId, type }];
        }
        return { ...state, edges: nextEdges, connecting: null };
    }

    return { ...state, connecting: null };
}

function escapeGmlString(str: string): string {
    return str.replace(/"/g, '``').replace(/'/g, '`').replace(/\n/g, '#');
}

export function makeGml(state: EditorState): string {
    let gml = `// GM8 对话系统导出 (有向图结构)\n// 使用编辑器重新加载此文件可编辑布局\n\nvar _g, _n, _l;\n_g = ds_graph_create();\n\n`;

    state.nodes.forEach((n) => {
        // 找到指向当前节点的父节点
        const parentEdges = state.edges.filter((e) => e.toId === n.id);
        const parentNodes = parentEdges.map((e) => state.nodes.find((node) => node.id === e.fromId));

        // 检查是否有父节点的出度 >= 2
        const hasParentWithOutDegree2 = parentNodes.some((parent) => {
            if (!parent) return false; // 如果父节点不存在，跳过
            const parentOutDegree = state.edges.filter((e) => e.fromId === parent.id).length;
            return parentOutDegree >= 2;
        });

        if (n.type === "node" && hasParentWithOutDegree2) {
            gml += `// Node #${n.id}\n_n[${n.id}] = ds_graph_node_add(_g, '\n`;
            gml += `    var _text; \n`;
            gml += `    _text[lang_cn] = "${escapeGmlString(n.cn)}";\n`;
            gml += `    _text[lang_en] = "${escapeGmlString(n.en)}";\n`;
            if (n.code) {
                gml += `    ${n.code.replace(/\n/g, "\n    ")}\n`;
                gml += `    //*/\n`;  // 防止用户未结束的多行注释将后面的内容注释掉
            }
            gml += `    return _text[global.language];\n`;
            gml += `');\n\n`;
        } else {
            gml += `// Node #${n.id}\n_n[${n.id}] = ds_graph_node_add(_g, '\n`;
            gml += `    var _text; \n`;
            gml += `    _text[lang_cn] = "${escapeGmlString(n.cn)}";\n`;
            gml += `    _text[lang_en] = "${escapeGmlString(n.en)}";\n`;
            gml += `    displayingText = _text[global.language];\n`;
            if (n.code) {
                gml += `    ${n.code.replace(/\n/g, "\n    ")}\n`;
                gml += `    //*/\n`;
            }
            gml += `');\n\n`;
        }
    });

    gml += `// 逻辑分支定义\n`;
    state.nodes.forEach((n) => {
        if (n.type === "condition") {
            const t = state.edges.find((e) => e.fromId === n.id && e.type === "true");
            const f = state.edges.find((e) => e.fromId === n.id && e.type === "false");
            gml += `// Condition Scope #${n.id}\n`;
            gml += `if (${n.code || "true"}) {\n`;
            if (t) gml += `    ds_graph_edge_add(_g, _n[${n.id}], _n[${t.toId}], 0, true);\n`;
            gml += `} else {\n`;
            if (f) gml += `    ds_graph_edge_add(_g, _n[${n.id}], _n[${f.toId}], 0, true);\n`;
            gml += `}\n\n`;
        } else {
            const e = state.edges.find((edge) => edge.fromId === n.id);
            if (e) gml += `ds_graph_edge_add(_g, _n[${n.id}], _n[${e.toId}], 0, true);\n`;
        }
    });

    gml += `\n_l = ds_list_create();\nds_list_add(_l, _g);\n`;

    if (state.nodes.length > 0) gml += `ds_list_add(_l, _n[0]);\n\n`;
    else gml += `ds_list_add(_l, -1);\n\n`;

    gml += `return _l;\n\n`;

    // 写入元数据
    const meta = btoa(encodeURIComponent(JSON.stringify(state)));
    gml += `/* EDITOR_DATA:${meta} */`;
    return gml;
}

export function parseGmlEditorData(text: string): EditorState | null {
    const startMarker = "/* EDITOR_DATA:";
    const endMarker = " */";
    const start = text.indexOf(startMarker);
    if (start === -1) return null;

    const metaStart = start + startMarker.length;
    const end = text.indexOf(endMarker, metaStart);
    if (end === -1) return null;

    const meta = text.slice(metaStart, end).trim();
    try {
        const decoded = decodeURIComponent(atob(meta));
        const parsed = JSON.parse(decoded) as EditorState;

        const base = createInitialState();
        return {
            ...base,
            nodes: Array.isArray(parsed.nodes) ? parsed.nodes : base.nodes,
            edges: Array.isArray(parsed.edges) ? parsed.edges : base.edges,
            comments: Array.isArray(parsed.comments)
                ? parsed.comments.map((c: any) => ({
                      id: String(c.id ?? ""),
                      x: typeof c.x === "number" ? c.x : 0,
                      y: typeof c.y === "number" ? c.y : 0,
                      w: typeof c.w === "number" ? c.w : 400,
                      h: typeof c.h === "number" ? c.h : 300,
                      text: typeof c.text === "string" ? c.text : "区域注释",
                      color: typeof c.color === "string" ? c.color : "#5865f2",
                  }))
                : base.comments,
            idCounter: typeof parsed.idCounter === "number" ? parsed.idCounter : base.idCounter,
            view:
                parsed.view &&
                typeof parsed.view.x === "number" &&
                typeof parsed.view.y === "number"
                    ? parsed.view
                    : base.view,
        };
    } catch {
        return null;
    }
}
