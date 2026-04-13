import React from "react";
import { DragTarget, EditorState, Node } from "../editorTypes";
import { hasEdge, startConnect } from "../editorLogic";

export const DraggableNode = React.memo(({
    n,
    isSelected,
    isConnecting,
    theme,
    state,
    beginDrag,
    beginTouchDrag,
    openModal,
    setState,
    setEdgeMenu,
    setSortingEdgeNodeId,
}: {
    n: Node;
    isSelected: boolean;
    isConnecting: boolean;
    theme: "dark" | "light";
    state: EditorState;
    beginDrag: (e: React.MouseEvent, target: DragTarget) => void;
    beginTouchDrag: (e: React.TouchEvent, target: DragTarget) => void;
    openModal: (id: number) => void;
    setState: React.Dispatch<React.SetStateAction<EditorState>>;
    setEdgeMenu: React.Dispatch<React.SetStateAction<{
        fromId: number; x: number; y: number; } | null>>
    setSortingEdgeNodeId: (id: number | null) => void;
}) => {
    const isCond = n.type === "condition";
    const isStart = n.type === "start";

    const defaultEdgeCount = state.edges.filter(e => e.fromId === n.id && e.type === "default").length;
    const hasMultiEdges = defaultEdgeCount >= 2;

    return (
        <div
            id={`node-${n.id}`}
            className={`node ${isStart ? "start-node" : ""} ${isSelected ? "selected" : ""}`}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
                left: n.x,
                top: n.y,
                transform: 'translate(-50%, -50%)',
                transformOrigin: 'center center',
                transition: state.dragTarget ? 'none' : 'left 0.15s ease-out, top 0.15s ease-out',
                borderColor: n.color,
                color: n.color,
                boxShadow: isConnecting ? `0 0 20px ${n.color}` : undefined,
            }}
        >
            <div
                className={`node-header ${isStart ? "start-node-header" : ""}`}
                onMouseDown={(e) =>
                    beginDrag(e, {
                        kind: "node",
                        id: n.id,
                        ox: e.clientX,
                        oy: e.clientY,
                    })
                }
                onTouchStart={(e) =>
                    beginTouchDrag(e, {
                        kind: "node",
                        id: n.id,
                        ox: e.touches[0].clientX,
                        oy: e.touches[0].clientY,
                    })
                }
            >
                <span style={{ textAlign: "center", color: "var(--text)" }}> {
                    isStart ? `#${n.id} 开始` : 
                        isCond ? `#${n.id} 条件` : 
                            n.type === "end" ? `#${n.id} 结束` :
                                `#${n.id} 对话：${n.character.name}`
                    }
                </span>
                {!isStart && (
                    <span
                        style={{ cursor: "pointer" }}
                        onClick={(e) => {
                            e.stopPropagation();
                            openModal(n.id);
                        }}
                    >
                        ⚙️
                    </span>
                )}
            </div>
            {!isStart && (
                <div
                    className="node-body has-tooltip"
                    title={n.type === "node" && n.code ? `执行代码：\n\n${n.code}` : undefined}
                    style={{color: "var(--text)"}}
                >
                    {isCond ? (
                        n.code || <><span style={{ color: "#888" }}>请添加有效的表达式。</span></>
                    ) : n.type === "end" ? (
                        n.code || <><span style={{ color: "#888" }}>请添加有效的代码语句。</span></>
                    ) : (
                        <>
                            <span style={{ color: "#888" }}>中文：</span>
                            {n.cn || <><span style={{ color: "#888" }}>无内容。</span></>}
                            <hr style={{ opacity: 0.2 }} />
                            <span style={{ color: "#888" }}>英文：</span>
                            {n.en || <><span style={{ color: "#888" }}>无内容。</span></>}
                        </>
                    )}
                </div>
            )}
            <div className={`node-footer ${isStart ? "start-node-footer" : ""}`}>
                {isCond ? (
                    <>
                        <button
                            className={`port ${hasEdge(state, n.id, "true") ? "connected" : ""}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                setState((prev) => startConnect(prev, n.id, "true"));
                            }}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setState((prev) => ({
                                    ...prev,
                                    edges: prev.edges.filter(
                                        (ed) => !(ed.fromId === n.id && ed.type === "true")
                                    ),
                                }));
                            }}
                            title="右键删除 TRUE 连线"
                        >
                            TRUE
                        </button>
                        <button
                            className={`port ${hasEdge(state, n.id, "false") ? "connected" : ""}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                setState((prev) => startConnect(prev, n.id, "false"));
                            }}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setState((prev) => ({
                                    ...prev,
                                    edges: prev.edges.filter(
                                        (ed) => !(ed.fromId === n.id && ed.type === "false")
                                    ),
                                }));
                            }}
                            title="右键删除 FALSE 连线"
                        >
                            FALSE
                        </button>
                    </>
                ) : (
                    <>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                            <button
                                className={`port ${hasEdge(state, n.id, "default") ? "connected" : ""}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setState((prev) => startConnect(prev, n.id, "default"));
                                }}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (n.type === "start") {
                                        setState((prev) => ({
                                            ...prev,
                                            edges: prev.edges.filter(
                                                (ed) => !(ed.fromId === n.id && ed.type === "default")
                                            ),
                                        }));
                                    } else {
                                        setEdgeMenu({
                                            fromId: n.id,
                                            x: e.clientX,
                                            y: e.clientY,
                                        });
                                    }
                                }}
                                title={n.type === "end" ? "" : "右键删除 NEXT 连线"}
                                style={{ flex: 1 }}
                            >
                                {n.type === "end" ? "结束" : "NEXT →"}
                            </button>
                            {hasMultiEdges && (
                                <button
                                    style={{
                                        padding: "4px 8px",
                                        fontSize: 10,
                                        height: "100%",
                                        margin: 0,
                                        borderRadius: 3,
                                    }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSortingEdgeNodeId(n.id);
                                    }}
                                    title="对连线进行排序"
                                >
                                    排序
                                </button>
                            )}
                        </div>
                        {isStart && (
                            <span
                                style={{ cursor: "pointer" }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    openModal(n.id);
                                }}
                            >
                                ⚙️
                            </span>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}, (prev, next) => {
    // 仅当关键属性变化时才重渲染
    return (
        prev.n.x === next.n.x &&
        prev.n.y === next.n.y &&
        prev.n.cn === next.n.cn &&
        prev.n.en === next.n.en &&
        prev.n.code === next.n.code &&
        prev.n.color === next.n.color &&
        prev.n.character === next.n.character &&
        prev.isSelected === next.isSelected &&
        prev.isConnecting === next.isConnecting &&
        prev.state.edges === next.state.edges &&
        prev.theme === next.theme
    );
});

DraggableNode.displayName = "DraggableNode";