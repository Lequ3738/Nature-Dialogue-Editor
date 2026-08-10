import type { Dispatch, SetStateAction } from "react";
import type { EditorState } from "../editorTypes";

export type EdgeMenuState = {
    fromId: number;
    x: number;
    y: number;
} | null;

type EdgeMenuProps = {
    edgeMenu: EdgeMenuState;
    state: EditorState;
    setState: Dispatch<SetStateAction<EditorState>>;
    setEdgeMenu: Dispatch<SetStateAction<EdgeMenuState>>;
    setSortingEdgeNodeId: (id: number | null) => void;
};

/** 连线右键菜单：删除单条 NEXT 连线、排序、清除全部 */
export function EdgeMenu({
    edgeMenu,
    state,
    setState,
    setEdgeMenu,
    setSortingEdgeNodeId,
}: EdgeMenuProps) {
    if (!edgeMenu) return null;

    const defaultEdges = state.edges.filter(
        (ed) => ed.fromId === edgeMenu.fromId && ed.type === "default"
    );

    return (
        <div
            style={{
                position: "fixed",
                left: edgeMenu.x,
                top: edgeMenu.y,
                zIndex: 4000,
                background: "var(--panel)",
                color: "var(--text)",
                border: "1px solid color-mix(in srgb, var(--panel-border) 80%, transparent)",
                borderRadius: 8,
                boxShadow: "var(--shadow-strong)",
                padding: 6,
                minWidth: 170,
            }}
            onMouseDown={(e) => {
                e.stopPropagation();
            }}
        >
            <div style={{ fontSize: 12, opacity: 0.85, padding: "4px 8px" }}>
                删除 NEXT 连线
            </div>
            {defaultEdges.length === 0 ? (
                <div style={{ fontSize: 12, opacity: 0.75, padding: "6px 8px" }}>
                    暂无连线
                </div>
            ) : (
                defaultEdges.map((ed, idx) => (
                    <button
                        key={`${ed.fromId}-${ed.toId}-${idx}`}
                        style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 10px",
                            borderRadius: 6,
                            background: "transparent",
                            color: "var(--text)",
                            boxShadow: "none",
                            fontWeight: 500,
                        }}
                        onClick={() => {
                            setState((prev) => ({
                                ...prev,
                                edges: prev.edges.filter(
                                    (e) =>
                                        !(
                                            e.fromId === ed.fromId &&
                                            e.toId === ed.toId &&
                                            e.type === ed.type
                                        )
                                ),
                            }));
                            setEdgeMenu(null);
                        }}
                    >
                        删除到 #{ed.toId}
                    </button>
                ))
            )}
            {defaultEdges.length >= 2 && (
                <button
                    style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 10px",
                        borderRadius: 6,
                        background: "transparent",
                        color: "var(--accent)",
                        boxShadow: "none",
                        fontWeight: 600,
                        borderTop: "1px solid var(--panel-border)",
                        marginTop: 4,
                    }}
                    onClick={() => {
                        setSortingEdgeNodeId(edgeMenu.fromId);
                        setEdgeMenu(null);
                    }}
                >
                    对连线排序
                </button>
            )}
            {defaultEdges.length > 0 ? (
                <button
                    style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 10px",
                        borderRadius: 6,
                        background: "transparent",
                        color: "#f04747",
                        boxShadow: "none",
                        fontWeight: 600,
                    }}
                    onClick={() => {
                        setState((prev) => ({
                            ...prev,
                            edges: prev.edges.filter(
                                (e) =>
                                    !(e.fromId === edgeMenu.fromId && e.type === "default")
                            ),
                        }));
                        setEdgeMenu(null);
                    }}
                >
                    清除全部
                </button>
            ) : null}
        </div>
    );
}
