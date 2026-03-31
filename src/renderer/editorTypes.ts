export type EdgeType = "default" | "true" | "false";

export interface Node {
    id: number;
    type: "node" | "condition";
    x: number;
    y: number;
    cn: string;
    en: string;
    code: string;
    color: string;
}

export interface CommentBox {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    text: string;
    color: string;
}

export interface Edge {
    fromId: number;
    toId: number;
    type: EdgeType;
}

export interface ViewState {
    x: number;
    y: number;
    zoom: number;
}

export type DragTarget =
    | { kind: "node"; id: number; ox: number; oy: number }
    | { kind: "comment"; id: string; ox: number; oy: number };

export interface Connecting {
    fromId: number;
    type: EdgeType;
}

export interface Resizing {
    id: string;
    ox: number;
    oy: number;
    startW: number;
    startH: number;
}

export interface EditorState {
    nodes: Node[];
    edges: Edge[];
    comments: CommentBox[];
    idCounter: number;
    view: ViewState;
    isPanning: boolean;
    lastMouse?: { x: number; y: number };
    dragTarget: DragTarget | null;
    connecting: Connecting | null;
    resizing: Resizing | null;
}

export function createInitialState(): EditorState {
    return {
        nodes: [],
        edges: [],
        comments: [],
        idCounter: 1,
        view: { x: 500, y: 500, zoom: 1 },
        isPanning: false,
        lastMouse: undefined,
        dragTarget: null,
        connecting: null,
        resizing: null,
    };
}
