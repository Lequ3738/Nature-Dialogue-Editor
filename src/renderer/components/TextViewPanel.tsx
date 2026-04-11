import React, { useMemo, useState } from "react";
import { addObject } from "../editorLogic";
import type { EditorState, FuncNodeType, Node } from "../editorTypes";

type TextViewPanelProps = {
    theme: "dark" | "light";
    state: EditorState;
    selectedNodeIds: number[];
    setState: React.Dispatch<React.SetStateAction<EditorState>>;
    onFocusGraphNode: (id: number) => void;
};

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceInText(text: string, search: string, replacement: string): string {
    if (!search) return text;
    const reg = new RegExp(escapeRegExp(search), "gi");
    return text.replace(reg, replacement);
}

function fieldMatch(text: string, search: string): boolean {
    if (!search) return false;
    return text.toLowerCase().includes(search.toLowerCase());
}

export default function TextViewPanel({
    theme,
    state,
    selectedNodeIds,
    setState,
    onFocusGraphNode,
}: TextViewPanelProps) {
    const [searchText, setSearchText] = useState("");
    const [replaceText, setReplaceText] = useState("");
    const [searchOnlySelected, setSearchOnlySelected] = useState(false);

    const visibleNodes = useMemo(() => {
        return state.nodes.filter((node) => {
            if (searchOnlySelected && !selectedNodeIds.includes(node.id)) return false;
            if (!searchText) return true;
            const q = searchText.toLowerCase();
            return [node.cn, node.en, node.code, node.color, node.character?.name ?? ""]
                .some((value) => String(value).toLowerCase().includes(q));
        });
    }, [searchOnlySelected, searchText, selectedNodeIds, state.nodes]);

    const applyNodePatch = (id: number, patch: Partial<Pick<Node, "cn" | "en" | "code" | "color">>) => {
        setState((prev) => ({
            ...prev,
            nodes: prev.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
        }));
    };

    const removeNode = (id: number) => {
        const ok = confirm(`确定删除 #${id} 吗？该节点关联的连线也会被移除。`);
        if (!ok) return;
        setState((prev) => ({
            ...prev,
            nodes: prev.nodes.filter((node) => node.id !== id),
            edges: prev.edges.filter((edge) => edge.fromId !== id && edge.toId !== id),
        }));
    };

    const addNode = (type: FuncNodeType) => {
        const viewportWidth = Math.max(window.innerWidth, 800);
        const viewportHeight = Math.max(window.innerHeight, 600);
        setState((prev) => addObject(prev, type, viewportWidth, viewportHeight));
    };

    const replaceAll = () => {
        if (!searchText.trim()) return;
        const ok = confirm(`将所有节点中的“${searchText}”替换为“${replaceText}”？`);
        if (!ok) return;

        setState((prev) => ({
            ...prev,
            nodes: prev.nodes.map((node) => ({
                ...node,
                cn: replaceInText(node.cn, searchText, replaceText),
                en: replaceInText(node.en, searchText, replaceText),
                code: replaceInText(node.code, searchText, replaceText),
            })),
        }));
    };

    const matchCount = useMemo(() => {
        if (!searchText) return state.nodes.length;
        return visibleNodes.length;
    }, [searchText, state.nodes.length, visibleNodes.length]);

    return (
        <div
            style={{
                position: "fixed",
                inset: "50px 0 0 0",
                overflow: "auto",
                background: "var(--bg)",
                color: "var(--text)",
            }}
            className="custom-scroll"
        >
            <div
                style={{
                    maxWidth: 1400,
                    margin: "0 auto",
                    padding: 18,
                    display: "grid",
                    gap: 16,
                }}
            >
                <div
                    style={{
                        background: "color-mix(in srgb, var(--panel) 92%, transparent)",
                        border: "1px solid var(--panel-border)",
                        borderRadius: 16,
                        boxShadow: "var(--shadow-strong)",
                        padding: 14,
                        display: "grid",
                        gap: 12,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ fontSize: 18, fontWeight: 700 }}>文本视图</div>
                        <div style={{ opacity: 0.75, fontSize: 12 }}>共 {state.nodes.length} 个节点，当前显示 {matchCount} 个</div>
                        <div style={{ flex: 1 }} />
                    </div>

                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "1.6fr 1fr auto auto",
                            gap: 10,
                            alignItems: "center",
                        }}
                    >
                        <input
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            className="textarea-styled"
                            placeholder="搜索节点文本、代码、角色名..."
                            style={{ width: "100%", boxSizing: 'border-box', }}
                        />
                        <input
                            value={replaceText}
                            onChange={(e) => setReplaceText(e.target.value)}
                            className="textarea-styled"
                            placeholder="替换为..."
                            style={{ width: "100%", boxSizing: 'border-box', }}
                        />
                        <button onClick={replaceAll} disabled={!searchText.trim()}>
                            全部替换
                        </button>
                        <button
                            className="secondary-button"
                            onClick={() => {
                                setSearchText("");
                                setReplaceText("");
                                setSearchOnlySelected(false);
                            }}
                        >
                            清除
                        </button>
                    </div>

                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, opacity: 0.9 }}>
                        <input
                            type="checkbox"
                            checked={searchOnlySelected}
                            onChange={(e) => setSearchOnlySelected(e.target.checked)}
                        />
                        仅搜索已选中的节点
                    </label>
                </div>

                {visibleNodes.length === 0 ? (
                    <div
                        style={{
                            border: "1px dashed var(--panel-border)",
                            borderRadius: 16,
                            padding: 24,
                            opacity: 0.75,
                            textAlign: "center",
                            background: "color-mix(in srgb, var(--panel) 85%, transparent)",
                        }}
                    >
                        没有匹配的节点。可以先清空搜索，或者新增一个对话节点。
                    </div>
                ) : (
                    <div style={{ display: "grid", gap: 12 }}>
                        {visibleNodes.map((node) => {
                            const selected = selectedNodeIds.includes(node.id);
                            const matched = !!searchText && [
                                node.cn,
                                node.en,
                                node.code,
                                node.color,
                                node.character?.name ?? "",
                            ].some((text) => fieldMatch(String(text), searchText));
                            return (
                                <div
                                    key={node.id}
                                    style={{
                                        background: "color-mix(in srgb, var(--panel) 92%, transparent)",
                                        border: `1px solid ${
                                            selected
                                                ? "var(--accent)"
                                                : matched
                                                    ? "color-mix(in srgb, var(--accent) 60%, var(--panel-border))"
                                                    : "var(--panel-border)"
                                        }`,
                                        borderRadius: 16,
                                        boxShadow: selected ? "0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent)" : "var(--shadow-strong)",
                                        padding: 14,
                                        display: "grid",
                                        gap: 12,
                                    }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                        <div style={{ fontWeight: 700 }}>
                                            #{node.id} · {node.type === "node" ? "对话" : node.type === "condition" ? "条件" : node.type === "start" ? "开始" : "结束"}
                                        </div>
                                        <div style={{ fontSize: 12, opacity: 0.75 }}>
                                            角色：{node.character?.name || "无角色"} · 颜色：{node.color}
                                        </div>
                                        <div style={{ flex: 1 }} />
                                        <button
                                            className="secondary-button"
                                            onClick={() => onFocusGraphNode(node.id)}
                                        >
                                            定位到图中
                                        </button>
                                        <button
                                            onClick={() => removeNode(node.id)}
                                            style={{ background: "#f04747" }}
                                        >
                                            删除
                                        </button>
                                    </div>

                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                                        <label style={{ display: "grid", gap: 6 }}>
                                            <span style={{ fontSize: 12, opacity: 0.75 }}>中文文本</span>
                                            <textarea
                                                value={node.cn}
                                                onChange={(e) => applyNodePatch(node.id, { cn: e.target.value })}
                                                style={{
                                                    width: "100%",
                                                    resize: "vertical",
                                                    minHeight: 92,
                                                    borderColor: matched && fieldMatch(node.cn, searchText) ? "var(--accent)" : undefined,
                                                    boxSizing: 'border-box',
                                                }}
                                            />
                                        </label>

                                        <label style={{ display: "grid", gap: 6 }}>
                                            <span style={{ fontSize: 12, opacity: 0.75 }}>英文文本</span>
                                            <textarea
                                                value={node.en}
                                                onChange={(e) => applyNodePatch(node.id, { en: e.target.value })}
                                                style={{
                                                    width: "100%",
                                                    resize: "vertical",
                                                    minHeight: 92,
                                                    borderColor: matched && fieldMatch(node.en, searchText) ? "var(--accent)" : undefined,
                                                    boxSizing: 'border-box',
                                                }}
                                            />
                                        </label>

                                        <label style={{ display: "grid", gap: 6 }}>
                                            <span style={{ fontSize: 12, opacity: 0.75 }}>代码 / 条件表达式</span>
                                            <textarea
                                                value={node.code}
                                                onChange={(e) => applyNodePatch(node.id, { code: e.target.value })}
                                                rows={Math.max(3, Math.min(8, node.code.split("\n").length + 1))}
                                                style={{
                                                    width: "100%",
                                                    resize: "vertical",
                                                    minHeight: 92,
                                                    borderColor: matched && fieldMatch(node.code, searchText) ? "var(--accent)" : undefined,
                                                    boxSizing: 'border-box',
                                                }}
                                            />
                                        </label>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
