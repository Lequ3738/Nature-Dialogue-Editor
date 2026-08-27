import React, { useMemo, useState } from "react";
import { addObject } from "../editorLogic";
import type { EditorState, FuncNodeType, Node } from "../editorTypes";
import HighlightTextarea from "./HighlightTextarea";

type TextViewPanelProps = {
    theme: "dark" | "light";
    state: EditorState;
    selectedNodeIds: number[];
    setState: React.Dispatch<React.SetStateAction<EditorState>>;
    onFocusGraphNode: (id: number) => void;
};

// 转义正则特殊字符
function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 替换文本：支持区分大小写、全字匹配
function replaceInText(
    text: string,
    search: string,
    replacement: string,
    caseSensitive: boolean,
    wholeWord: boolean
): string {
    if (!search) return text;
    const escapedSearch = escapeRegExp(search);
    const pattern = wholeWord ? `\\b${escapedSearch}\\b` : escapedSearch;
    const flags = caseSensitive ? "g" : "gi";
    const reg = new RegExp(pattern, flags);
    return text.replace(reg, replacement);
}

// 字段匹配：支持区分大小写、全字匹配
function fieldMatch(
    text: string,
    search: string,
    caseSensitive: boolean,
    wholeWord: boolean
): boolean {
    if (!search) return false;
    const escapedSearch = escapeRegExp(search);
    const pattern = wholeWord ? `\\b${escapedSearch}\\b` : escapedSearch;
    const flags = caseSensitive ? "g" : "gi";
    const reg = new RegExp(pattern, flags);
    return reg.test(text);
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
    const [replaceOnlyCn, setReplaceOnlyCn] = useState(false);
    const [replaceOnlyEn, setReplaceOnlyEn] = useState(false);
    const [replaceOnlyCode, setReplaceOnlyCode] = useState(false);
    // 新增：区分大小写 状态
    const [caseSensitive, setCaseSensitive] = useState(false);
    // 新增：全字匹配 状态
    const [wholeWord, setWholeWord] = useState(false);

    // 过滤可见节点：支持区分大小写、全字匹配
    const visibleNodes = useMemo(() => {
        return state.nodes.filter((node) => {
            // 仅选中节点过滤
            if (searchOnlySelected && !selectedNodeIds.includes(node.id)) return false;
            // 无搜索词时显示全部
            if (!searchText) return true;
            // 匹配字段：支持区分大小写、全字匹配
            const matchFields = [
                node.cn,
                node.en,
                node.code,
                node.color,
                node.tag,
                node.character?.name ?? ""
            ];
            return matchFields.some((value) => 
                fieldMatch(String(value), searchText, caseSensitive, wholeWord)
            );
        });
    }, [searchOnlySelected, searchText, selectedNodeIds, state.nodes, caseSensitive, wholeWord]);

    // 高亮样式：去掉color，避免重复显示
    const highlightStyle = useMemo(() => ({
        backgroundColor: theme === "dark" ? "#fbbf24" : "#fde047",
        borderRadius: "2px",
    }), [theme]);

    // 节点内容更新
    const applyNodePatch = (id: number, patch: Partial<Pick<Node, "cn" | "en" | "code" | "color" | "tag">>) => {
        setState((prev) => ({
            ...prev,
            nodes: prev.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
        }));
    };

    // 删除节点
    const removeNode = (id: number) => {
        const ok = confirm(`确定删除 #${id} 吗？该节点关联的连线也会被移除。`);
        if (!ok) return;
        setState((prev) => ({
            ...prev,
            nodes: prev.nodes.filter((node) => node.id !== id),
            edges: prev.edges.filter((edge) => edge.fromId !== id && edge.toId !== id),
        }));
    };

    // 新增节点
    const addNode = (type: FuncNodeType) => {
        const viewportWidth = Math.max(window.innerWidth, 800);
        const viewportHeight = Math.max(window.innerHeight, 600);
        setState((prev) => addObject(prev, type, viewportWidth, viewportHeight));
    };

    // 全部替换：支持区分大小写、全字匹配
    const replaceAll = () => {
        if (!searchText.trim()) return;
        // 计算替换范围：全不选=全选
        const replaceScope = {
            cn: replaceOnlyCn || (!replaceOnlyCn && !replaceOnlyEn && !replaceOnlyCode),
            en: replaceOnlyEn || (!replaceOnlyCn && !replaceOnlyEn && !replaceOnlyCode),
            code: replaceOnlyCode || (!replaceOnlyCn && !replaceOnlyEn && !replaceOnlyCode),
        };
        // 生成确认提示文本
        const scopeText = [];
        if (replaceScope.cn) scopeText.push("中文");
        if (replaceScope.en) scopeText.push("英文");
        if (replaceScope.code) scopeText.push("代码");
        const matchModeText = [];
        if (caseSensitive) matchModeText.push("区分大小写");
        if (wholeWord) matchModeText.push("全字匹配");
        const ok = confirm(`将${searchOnlySelected ? "已选中" : "所有"}节点中${scopeText.join("、")}字段里的「${searchText}」替换为「${replaceText}」？\n匹配规则：${matchModeText.length > 0 ? matchModeText.join("、") : "默认"}`);
        if (!ok) return;
        setState((prev) => ({
            ...prev,
            nodes: prev.nodes.map((node) => {
                // 仅处理选中的节点（如果开启了仅搜索选中）
                if (searchOnlySelected && !selectedNodeIds.includes(node.id)) return node;
                return {
                    ...node,
                    cn: replaceScope.cn ? replaceInText(node.cn, searchText, replaceText, caseSensitive, wholeWord) : node.cn,
                    en: replaceScope.en ? replaceInText(node.en, searchText, replaceText, caseSensitive, wholeWord) : node.en,
                    code: replaceScope.code ? replaceInText(node.code, searchText, replaceText, caseSensitive, wholeWord) : node.code,
                };
            }),
        }));
    };

    // 匹配节点计数
    const matchCount = useMemo(() => {
        if (!searchText) return state.nodes.length;
        return visibleNodes.length;
    }, [searchText, state.nodes.length, visibleNodes.length]);

    // 清除所有搜索/替换条件
    const handleClear = () => {
        setSearchText("");
        setReplaceText("");
        setSearchOnlySelected(false);
        setReplaceOnlyCn(false);
        setReplaceOnlyEn(false);
        setReplaceOnlyCode(false);
        setCaseSensitive(false);
        setWholeWord(false);
    };

    // ========== 核心修复：搜索栏总高度常量，用于滚动容器的顶部padding ==========
    const SEARCH_BAR_TOTAL_HEIGHT = 165; // 上下padding + 搜索栏内容最大高度
    return (
        <div
            style={{
                position: "fixed",
                inset: "50px 0 0 0",
                display: "flex",
                flexDirection: "column",
                background: "var(--bg)",
                color: "var(--text)",
                overflow: "hidden", // 修复：根容器禁止溢出，仅内部滚动容器可滚动
            }}
        >
            {/* ========== 【核心修复】悬浮毛玻璃搜索/替换栏 ========== */}
            {/* 改为absolute悬浮，脱离文档流，不占据高度，节点可滚动到其后方 */}
            <div
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    maxWidth: 1400,
                    width: "100%",
                    margin: "0 auto",
                    padding: "18px 18px 0",
                    boxSizing: "border-box",
                    zIndex: 10,
                }}
            >
                {/* 毛玻璃核心容器 */}
                <div
                    style={{
                        // 核心毛玻璃效果：背景模糊，捕获后方滚动的节点
                        backdropFilter: "blur(12px)",
                        WebkitBackdropFilter: "blur(12px)",
                        // 修复：降低背景不透明度，保证后方节点可见，同时保证文字清晰
                        background: "color-mix(in srgb, var(--bg) 22%, transparent)",
                        // 半透明边框，贴合毛玻璃质感
                        border: "1px solid color-mix(in srgb, var(--panel-border) 35%, transparent)",
                        borderRadius: 16,
                        // 柔和阴影，适配毛玻璃的轻盈质感
                        //boxShadow: "0 8px 32px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)",
                        padding: 14,
                        display: "grid",
                        gap: 12,
                        // 硬件加速：避免模糊效果闪烁
                        transform: "translateZ(0)",
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
                            onClick={handleClear}
                        >
                            清除
                        </button>
                    </div>
                    {/* 匹配规则复选框 */}
                    <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, opacity: 0.9 }}>
                            <input
                                type="checkbox"
                                checked={searchOnlySelected}
                                onChange={(e) => setSearchOnlySelected(e.target.checked)}
                            />
                            仅搜索已选中的节点
                        </label>
                        <span style={{ fontSize: 13, opacity: 0.5 }}>|</span>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, opacity: 0.9 }}>
                            <input
                                type="checkbox"
                                checked={caseSensitive}
                                onChange={(e) => setCaseSensitive(e.target.checked)}
                            />
                            区分大小写
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, opacity: 0.9 }}>
                            <input
                                type="checkbox"
                                checked={wholeWord}
                                onChange={(e) => setWholeWord(e.target.checked)}
                            />
                            全字匹配
                        </label>
                        <span style={{ fontSize: 13, opacity: 0.5 }}>|</span>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, opacity: 0.9 }}>
                            <input
                                type="checkbox"
                                checked={replaceOnlyCn}
                                onChange={(e) => setReplaceOnlyCn(e.target.checked)}
                            />
                            仅替换中文
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, opacity: 0.9 }}>
                            <input
                                type="checkbox"
                                checked={replaceOnlyEn}
                                onChange={(e) => setReplaceOnlyEn(e.target.checked)}
                            />
                            仅替换英文
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, opacity: 0.9 }}>
                            <input
                                type="checkbox"
                                checked={replaceOnlyCode}
                                onChange={(e) => setReplaceOnlyCode(e.target.checked)}
                            />
                            仅替换代码
                        </label>
                    </div>
                </div>
                {/* 修复：底部渐变遮罩改为从半透明bg到完全透明，不遮挡节点 */}
                <div
                    style={{
                        position: "absolute",
                        left: 18,
                        right: 18,
                        bottom: -20,
                        height: 20,
                        background: "linear-gradient(to bottom, color-mix(in srgb, var(--bg) 60%, transparent), transparent)",
                        pointerEvents: "none",
                        zIndex: 9,
                    }}
                />
            </div>

            {/* ========== 【核心修复】滚动容器 ========== */}
            <div
                className="custom-scroll"
                style={{
                    flex: 1,
                    overflowY: "auto",
                    overflowX: "hidden",
                    // 修复：顶部padding等于搜索栏总高度，初始内容在搜索栏下方，滚动时可滑到搜索栏后方
                    padding: `${SEARCH_BAR_TOTAL_HEIGHT}px 18px 18px`,
                    boxSizing: "border-box",
                    width: "100%",
                    maxWidth: 1400,
                    margin: "0 auto",
                    // 修复：滚动容器层级低于搜索栏
                    zIndex: 1,
                }}
            >
                <div
                    style={{
                        display: "grid",
                        gap: 12,
                    }}
                >
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
                        visibleNodes.map((node) => {
                            const selected = selectedNodeIds.includes(node.id);
                            const matched = !!searchText && [
                                node.cn,
                                node.en,
                                node.code,
                                node.color,
                                node.tag,
                                node.character?.name ?? "",
                            ].some((text) => fieldMatch(String(text), searchText, caseSensitive, wholeWord));
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
                                            #{node.id} {node.type === "node" ? "对话" : node.type === "condition" ? "条件" : node.type === "start" ? "开始" : "结束"}
                                        </div>
                                        <div style={{ fontSize: 12, opacity: 0.75, display: "flex", alignItems: "center", gap: 6 }}>
                                            角色：{node.character?.name || "无角色"}&emsp;&emsp;颜色：
                                            <span style={{ 
                                                display: "inline-flex", 
                                                alignItems: "center", 
                                                gap: 4 
                                            }}>
                                                <span style={{
                                                    width: 14,
                                                    height: 14,
                                                    borderRadius: 3,
                                                    background: node.color,
                                                    border: `1px solid ${theme === "dark" ? "#fff" : "#000"}`,
                                                    display: "inline-block",
                                                }}></span>
                                                {node.color}
                                            </span>
                                            {node.type === "node" && node.tag && (
                                                <span style={{
                                                    fontSize: 11,
                                                    lineHeight: 1,
                                                    padding: "3px 8px",
                                                    borderRadius: 999,
                                                    background: "color-mix(in srgb, var(--accent) 22%, transparent)",
                                                    border: "1px solid color-mix(in srgb, var(--accent) 55%, transparent)",
                                                    color: "var(--accent)",
                                                }}>
                                                    🔖 {node.tag}
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ flex: 1 }} />
                                        {node.type === "node" && (
                                            <>
                                            <label>标记：</label>
                                            <input style={{ width: 150 }}
                                                className="textarea-styled"
                                                value={node.tag ?? ""}
                                                onChange={(e) => applyNodePatch(node.id, { tag: e.target.value })}
                                            />
                                            </>
                                        )}
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
                                            <HighlightTextarea
                                                value={node.cn}
                                                onChange={(e) => applyNodePatch(node.id, { cn: e.target.value })}
                                                highlight={searchText}
                                                highlightStyle={highlightStyle}
                                                caseSensitive={caseSensitive}
                                                wholeWord={wholeWord}
                                                style={{
                                                    width: "100%",
                                                    resize: "vertical",
                                                    minHeight: 92,
                                                    borderColor: matched && fieldMatch(node.cn, searchText, caseSensitive, wholeWord) ? "var(--accent)" : undefined,
                                                    boxSizing: 'border-box',
                                                }}
                                                spellCheck="false"
                                            />
                                        </label>
                                        <label style={{ display: "grid", gap: 6 }}>
                                            <span style={{ fontSize: 12, opacity: 0.75 }}>英文文本</span>
                                            <HighlightTextarea
                                                value={node.en}
                                                onChange={(e) => applyNodePatch(node.id, { en: e.target.value })}
                                                highlight={searchText}
                                                highlightStyle={highlightStyle}
                                                caseSensitive={caseSensitive}
                                                wholeWord={wholeWord}
                                                style={{
                                                    width: "100%",
                                                    resize: "vertical",
                                                    minHeight: 92,
                                                    borderColor: matched && fieldMatch(node.en, searchText, caseSensitive, wholeWord) ? "var(--accent)" : undefined,
                                                    boxSizing: 'border-box',
                                                }}
                                                spellCheck="false"
                                            />
                                        </label>
                                        <label style={{ display: "grid", gap: 6 }}>
                                            <span style={{ fontSize: 12, opacity: 0.75 }}>代码 / 条件表达式</span>
                                            <HighlightTextarea
                                                value={node.code}
                                                onChange={(e) => applyNodePatch(node.id, { code: e.target.value })}
                                                highlight={searchText}
                                                highlightStyle={highlightStyle}
                                                caseSensitive={caseSensitive}
                                                wholeWord={wholeWord}
                                                style={{
                                                    width: "100%",
                                                    resize: "vertical",
                                                    minHeight: 92,
                                                    borderColor: matched && fieldMatch(node.code, searchText, caseSensitive, wholeWord) ? "var(--accent)" : undefined,
                                                    boxSizing: 'border-box',
                                                }}
                                                spellCheck="false"
                                            />
                                        </label>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}