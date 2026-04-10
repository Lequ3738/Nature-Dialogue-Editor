import type { CommentBox, Edge, EdgeType, EditorState, Node, NodeType } from "./editorTypes";
import { characterNone, createInitialState } from "./editorTypes";
import pako from 'pako';

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

function getNodeDefaultColor(type: NodeType): string {
    switch (type) {
        case "comment": return "#3baa71";
        case "node": return "#7289da";
        case "condition": return "#e67e22";
        case "start": return "#E544F2";
        case "end": return "#95a5a6";
        default: return "#95a5a6";
    }
}

function getNodeDefaultText(type: NodeType): string {
    switch (type) {
        case "start": return "开始";
        case "end": return "结束";
        default: return "";
    }
}

export function addObject(
    state: EditorState,
    type: NodeType,
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
            color: getNodeDefaultColor(type),
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
        cn: getNodeDefaultText(type),
        en: "",
        code: "",
        color: getNodeDefaultColor(type),
        character: characterNone
    };
    return { ...state, nodes: [...state.nodes, next], idCounter: state.idCounter + 1 };
}

export function startConnect(
    state: EditorState,
    destinationNodeId: number,
    portType: EdgeType
): EditorState {
    const targetNode = state.nodes.find(n => n.id === destinationNodeId);

    if (!state.connecting) {
        if (targetNode?.type === "end") {  // 结束节点不能向外连接
            return state;
        }

        return { ...state, connecting: { fromId: destinationNodeId, type: portType } };
    }

    const { fromId, type } = state.connecting;
    const sourceNode = state.nodes.find(n => n.id === fromId);

    if (fromId !== destinationNodeId) {
        // 开始节点不能被对话和结束节点连入
        if (targetNode?.type === "start" && sourceNode?.type !== "condition") {
            return { ...state, connecting: null }; // 重置连线状态
        }

        // 条件节点：true/false 各只能有一条（覆盖旧的同类型连线）
        // 普通节点：default 允许多条（不覆盖）
        let nextEdges: Edge[] = state.edges;
        if (type === "true" || type === "false" || sourceNode?.type === "start") {
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

function getParentNodes(state: EditorState, node: Node): Node[] {
    // 找到所有指向该节点的连线
    const parentEdges = state.edges.filter((e) => e.toId === node.id);

    // 根据连线的 fromId 找到对应的节点对象，并过滤掉可能的空值
    return parentEdges
        .map((e) => state.nodes.find((n) => n.id === e.fromId))
        .filter((n): n is Node => n !== undefined);
}

function getChildNodes(state: EditorState, node: Node): Node[] {
    const childEdges = state.edges.filter((e) => e.fromId === node.id);

    return childEdges
        .map((e) => state.nodes.find((n) => n.id === e.toId))
        .filter((n): n is Node => n !== undefined);
}

/**
 * 递归辅助函数：用于解析从某个起点出发，经过条件节点后到达的对话节点。
 * 它会根据路径生成嵌套的 if/else 结构。
 */
function resolveTargetNode(
    state: EditorState,
    targetNode: Node,
    context: { sourceNodeId?: number; isStart: boolean; edgeIndex?: number },
    indent: string = ""
): string {
    // 情况 A：到达了普通的对话节点
    if (targetNode.type === "node") {
        if (context.isStart) {
            return `${indent}_start = _node[${targetNode.id}];\n`;
        } else if (context.sourceNodeId !== undefined) {
            // 这里生成连线，context.edgeIndex 用于处理选择枝索引
            return `${indent}ds_graph_edge_add(_graph, _node[${context.sourceNodeId}], _node[${targetNode.id}], ${context.edgeIndex ?? 0}, true);\n`;
        }
    }
    // 情况 B：到达了条件节点，需要递归生成 if/else
    else if (targetNode.type === "condition") {
        const trueEdge = state.edges.find((e) => e.fromId === targetNode.id && e.type === "true");
        const falseEdge = state.edges.find((e) => e.fromId === targetNode.id && e.type === "false");

        let code = `${indent}if (${targetNode.code || "true"}) {\n`;
        if (trueEdge) {
            const next = state.nodes.find(n => n.id === trueEdge.toId);
            if (next) code += resolveTargetNode(state, next, context, indent + "    ");
        }
        code += `${indent}} else {\n`;
        if (falseEdge) {
            const next = state.nodes.find(n => n.id === falseEdge.toId);
            if (next) code += resolveTargetNode(state, next, context, indent + "    ");
        }
        code += `${indent}}\n`;
        return code;
    }
    return "";
}

/**
 * 辅助函数：寻找某个节点“有效”的对话节点父辈（穿透条件节点）
 */
function findEffectiveDialogueParents(state: EditorState, nodeId: number, visited = new Set<number>()): Node[] {
    if (visited.has(nodeId)) return [];
    visited.add(nodeId);

    const parentEdges = state.edges.filter(e => e.toId === nodeId);
    let results: Node[] = [];

    parentEdges.forEach(edge => {
        const p = state.nodes.find(n => n.id === edge.fromId);
        if (!p) return;
        if (p.type === "node") {
            results.push(p);
        } else {
            // 穿透条件节点或开始节点继续往回找
            results = [...results, ...findEffectiveDialogueParents(state, p.id, visited)];
        }
    });
    return Array.from(new Set(results));
}

// 获取当前日期时间
function getCurrentDateTime(): string {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

function compressToBase64(str: string): string {
    // 1. 字符串转为 UTF-8 字节数组
    const encoder = new TextEncoder();
    const rawData = encoder.encode(str);

    // 2. 使用 pako 进行 gzip 压缩
    const compressedData = pako.gzip(rawData);

    // 3. Uint8Array 转 Base64 (分块处理防止栈溢出)
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < compressedData.length; i += chunkSize) {
        const chunk = compressedData.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
    }
    return btoa(binary);
}

function decompressFromBase64(base64Str: string): string {
    // 1. Base64 转回 Uint8Array
    const binaryStr = atob(base64Str);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }

    // 2. 解压
    const decompressedData = pako.ungzip(bytes);

    // 3. 转回字符串
    const decoder = new TextDecoder();
    return decoder.decode(decompressedData);
}

export function makeGml(state: EditorState): string {
    let gml = `// 对话文件：${state.title}\n`;
    gml += state.author ? `// 作者：${state.author}\n` : "";
    gml += state.version ? `// 版本：${state.version}\n` : "";
    gml += state.description ? `// 描述：${state.description}\n` : "";
    gml += `// 最后修改时间: ${getCurrentDateTime()}\n\n`;

    const exp = state.forbiddenExpression;
    gml += `if (${exp || "false"})\n    return self;\n\n`;
    gml += `if (object_index != objGame)\n    return noone;\n\n`

    // 自定义变量定义阶段
    gml += `// --- 自定义变量 ---\n`;
    state.variables.forEach(v => {
        const value = typeof v.value === "string" && v.type === "string" ? 
            `"${v.value.replace(/"/g, '')}"` : 
            String(v.value);
        
        if (v.persistent)
            gml += `scrDefault("${v.name}", ${value});\n`;
        else
            gml += `${v.name} = ${value};\n`;
    });

    gml += "\nvar _graph, _node, _list, _start;\n";
    gml += "_start = -1;\n";
    gml += "_graph = ds_graph_create();\n\n";

    // 节点定义阶段：只添加普通的对话节点
    gml += `// --- 节点定义 ---\n\n`;

    state.nodes.forEach((n) => {
        if (n.type !== "node") return;

        // 检查是否是选择枝的结果（父节点出度 >= 2）
        const parents = getParentNodes(state, n);
        const isChoiceResult = parents.some(p =>
            state.edges.filter(e => e.fromId === p.id).length >= 2 && p.type === "node"
        );

        gml += `_node[${n.id}] = ds_graph_node_add(_graph, '\n`;
        if (!isChoiceResult) gml += `    curCharacter = ${n.character.constantName};\n\n`;
        gml += `    var _text; \n`;
        gml += `    _text[lang_cn] = "${escapeGmlString(n.cn)}";\n`;
        gml += `    _text[lang_en] = "${escapeGmlString(n.en)}";\n`;

        if (isChoiceResult) {
            if (n.code) gml += `    ${n.code.replace(/\n/g, "\n    ")}\n`;
            gml += `    //*/\n`;
            gml += `    return _text[global.language];\n`;
        } else {
            gml += `    displayingText = _text[global.language];\n\n`;
            if (n.code) gml += `    ${n.code.replace(/\n/g, "\n    ")}\n`;
            gml += `    //*/\n`;
        }
        gml += `');\n\n`;
    });

    gml += `\n// --- 逻辑分支与连线定义 ---\n\n`;

    // 开始节点处理：定义 _start 变量指向哪里
    const startNode = state.nodes.find(n => n.type === "start");
    if (startNode) {
        const outgoing = state.edges.filter(e => e.fromId === startNode.id);
        outgoing.forEach(edge => {
            const target = state.nodes.find(n => n.id === edge.toId);
            if (target) {
                gml += resolveTargetNode(state, target, { isStart: true });
            }
        });
    }

    // 对话节点连线处理（含嵌套条件与选择枝）
    state.nodes.forEach((n) => {
        if (n.type !== "node") return;

        const outgoingEdges = state.edges.filter(e => e.fromId === n.id);
        outgoingEdges.forEach((edge, index) => {
            const target = state.nodes.find(node => node.id === edge.toId);
            if (target) {
                // 生成连线逻辑，index 作为选择枝的索引
                gml += resolveTargetNode(state, target, {
                    isStart: false,
                    sourceNodeId: n.id,
                    edgeIndex: index
                });
            }
        });
    });

    // 结束节点处理：生成 dialog_end
    gml += "\n\n// --- 对话结束逻辑 ---\n\n";
    state.nodes.forEach((n) => {
        if (n.type !== "end") return;

        // 找到所有能到达这个结束节点的对话节点
        const effectiveParents = findEffectiveDialogueParents(state, n.id);
        effectiveParents.forEach((parent) => {
            gml += `dialog_end(_node[${parent.id}], '\n`;
            if (n.code) {
                gml += `    ${n.code.replace(/\n/g, "\n    ")}\n`;
            }
            gml += `');\n\n`;
        });
    });

    gml += `_list = ds_list_create();\n`;
    gml += `ds_list_add(_list, _graph);\n`;
    gml += `ds_list_add(_list, _start);\n`;
    gml += `return _list;\n\n`;

    // 写入编辑器元数据
    const meta = compressToBase64(JSON.stringify(state));
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
        const decoded = decompressFromBase64(meta);
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
            view: parsed.view && typeof parsed.view.x === "number" && typeof parsed.view.y === "number"
                ? parsed.view : base.view,
            
            title: typeof parsed.title === "string" ? parsed.title : base.title,
            description: typeof parsed.description === "string" ? parsed.description : base.description,
            author: typeof parsed.author === "string" ? parsed.author : base.author,
            version: typeof parsed.version === "string" ? parsed.version : base.version,
            forbiddenExpression: typeof parsed.forbiddenExpression === "string" ?
                parsed.forbiddenExpression : base.forbiddenExpression,
            
            variables: Array.isArray(parsed.variables) ? parsed.variables : base.variables,
        };
    } catch {
        return null;
    }
}