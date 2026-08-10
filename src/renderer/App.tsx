import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import type { CodeStyleProfile } from "./CodeEditor";
import type { ConfigTabs, EditorState, ProjectData, ViewMode } from "./editorTypes";
import { createInitialState, defaultProfile } from "./editorTypes";
import { reorderEdgesByDefaultBranch, SortableEdgeReorderModal } from "./components/ReorderList";
import { TopBar } from "./components/TopBar";
import TextViewPanel from "./components/TextViewPanel";
import { DraggableNode } from "./components/Node";
import { CommentNode } from "./components/Comment";
import { SelectionBox } from "./components/SelectionBox";
import { MiniMap } from "./components/MiniMap";
import { EditingCommentWindows, EditingNodeWindows } from "./components/EditingWindow";
import { EdgeMenu, type EdgeMenuState } from "./components/EdgeMenu";
import { SettingsOverlay } from "./components/SettingsOverlay";
import { useViewportInteractions } from "./hooks/useViewportInteractions";
import { useFileHandling } from "./hooks/useFileHandling";
import { useNodeEditing } from "./hooks/useNodeEditing";
import { useEdgeCanvas } from "./hooks/useEdgeCanvas";
import { useMinimap } from "./hooks/useMinimap";
import { useEdgeSorting } from "./hooks/useEdgeSorting";

/**
 * 该文件是渲染进程主 UI 的组合入口：工具栏、工作区视口、节点/注释框渲染、
 * 连线绘制、缩略图、文件打开/保存/另存为、主题切换与设置面板。
 *
 * 各个子系统已抽离到独立的 hooks 与组件中，本文件只负责状态编排与 JSX 装配：
 * - 文件读写/脏标记     → useFileHandling
 * - 视口鼠标/触摸交互   → useViewportInteractions
 * - 节点/注释编辑弹窗   → useNodeEditing
 * - 连线排序弹窗        → useEdgeSorting
 * - 主画布连线绘制      → useEdgeCanvas
 * - 缩略图              → useMinimap
 * - 内联 UI 面板        → SelectionBox / EdgeMenu / SettingsOverlay
 */

/** 校验并修复导入的代码配色配置，兼容旧版规则结构 */
function validateProfile(p: any) {
    if (!p.keywordGroups) p.keywordGroups = [];
    if (!p.characters) p.characters = [];
    if (p.rules && p.keywordGroups.length === 0) {
        p.keywordGroups = [{ id: "legacy", name: "旧版规则", colorLight: "#000000", colorDark: "#FFFFFF", keywords: p.rules.map((r: any) => r.pattern) }];
    }
    return p;
}

export default function App() {
    const [state, setState] = useState<EditorState>(() => createInitialState());
    const [theme, setTheme] = useState<"dark" | "light">(localStorage.getItem("dialogueEditor.theme") === "light" ? "light" : "dark");
    const stateRef = useRef(state);
    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    // 动画帧 ref，用于控制缓动吸附动画
    const animationFrameRef = useRef<number | null>(null);
    useEffect(() => {
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, []);

    const [viewMode, setViewMode] = useState<ViewMode>("graph");
    const viewModeRef = useRef<ViewMode>("graph");
    useEffect(() => {
        viewModeRef.current = viewMode;
    }, [viewMode]);

    // 窗口尺寸与重绘 tick
    const [windowSize, setWindowSize] = useState(() => ({
        w: window.innerWidth,
        h: window.innerHeight,
    }));
    const [tick, setTick] = useState(0);  // 窗口缩放监听
    useEffect(() => {
        const handleResize = () => setTick(t => t + 1);
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);
    useEffect(() => {
        const onResize = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight });
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    useLayoutEffect(() => {
        if (viewMode === "graph") {
            setTick((t) => t + 1);
        }
    }, [viewMode]);

    // 初始将视口移动到工作区中心
    useEffect(() => {
        setState((prev) => ({
            ...prev,
            view: {
                ...prev.view,
                x: window.innerWidth / 2 - 5000,
                y: window.innerHeight / 2 - 5000,
            },
        }));
    }, []);

    // 主题
    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
    }, [theme]);

    // 视口变换同步到 CSS 变量（供 grid 背景等使用）
    useEffect(() => {
        const root = document.documentElement;
        root.style.setProperty("--view-x", String(state.view.x));
        root.style.setProperty("--view-y", String(state.view.y));
        root.style.setProperty("--view-zoom", String(state.view.zoom));
    }, [state.view.x, state.view.y, state.view.zoom]);

    // 代码配色配置：从 localStorage 加载并持久化
    const [codeProfile, setCodeProfile] = useState<CodeStyleProfile>(() => {
        let profile = defaultProfile;
        try {
            const raw = localStorage.getItem("dialogueEditor.codeProfile");
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed)
                    profile = validateProfile(parsed);
            }
        } catch (e) {
            console.error("加载配置失败:", e);
        }
        return profile;
    });
    useEffect(() => {
        console.log("Saving code profile:", codeProfile);
        localStorage.setItem("dialogueEditor.codeProfile", JSON.stringify(codeProfile));
    }, [codeProfile]);

    // 设置面板中的编辑状态
    const [draftProfile, setDraftProfile] = useState<CodeStyleProfile | null>(null);
    const [draftProjectState, setDraftProjectState] = useState<ProjectData | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsTab, setSettingsTab] = useState<ConfigTabs>("info");
    useEffect(() => {
        setDraftProfile(codeProfile);
    }, [codeProfile]);

    // 代码配色配置的导出/导入
    const handleExport = () => {
        const data = JSON.stringify(draftProfile, null, 2);
        const blob = new Blob([data], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${draftProfile ? draftProfile.name : "新配置"}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };
    const handleImport = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const imported = JSON.parse(event.target?.result as string) as CodeStyleProfile;
                // 基础校验：确保包含必要的 keywordGroups 字段
                if (imported.keywordGroups) {
                    setCodeProfile(validateProfile(imported));
                } else {
                    alert("导入失败：文件格式不正确");
                }
            } catch (err) {
                alert("导入失败：文件格式不正确");
            }
            // 清空 input，保证可以连续导入同一个文件进行覆盖测试
            e.target.value = "";
        };
        reader.readAsText(file);
    };

    // 文件菜单
    const [fileMenuOpen, setFileMenuOpen] = useState(false);
    const fileMenuRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (!fileMenuOpen) return;
            const el = fileMenuRef.current;
            if (el && e.target instanceof Node && el.contains(e.target)) return;
            setFileMenuOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [fileMenuOpen]);

    // 连线右键菜单
    const [edgeMenu, setEdgeMenu] = useState<EdgeMenuState>(null);
    useEffect(() => {
        const onDown = () => {
            if (edgeMenu) setEdgeMenu(null);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [edgeMenu]);

    // 画布与视口 refs
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const lineCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const connectingFromId = state.connecting?.fromId ?? null;

    // 各子系统
    const editing = useNodeEditing(state, setState);
    const viewport = useViewportInteractions({
        viewportRef,
        stateRef,
        state,
        setState,
        viewModeRef,
        animationFrameRef,
    });
    const file = useFileHandling({
        state,
        setState,
        setSelectionBox: viewport.setSelectionBox,
        setSelectedNodeIds: viewport.setSelectedNodeIds,
        selectionDragRef: viewport.selectionDragRef,
        setFileMenuOpen,
        onClearEditing: editing.closeModal,
    });
    const sorting = useEdgeSorting(state);
    useEdgeCanvas({ lineCanvasRef, state, windowSize, tick, viewMode });
    const minimap = useMinimap({
        minimapCanvasRef,
        state,
        theme,
        viewMode,
        windowSize,
        tick,
        connectingFromId,
    });

    const zoomPercent = Math.round(state.view.zoom * 100);

    const viewportTransformStyle = useMemo(
        () =>
            ({
                transform: `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.zoom})`,
            }) satisfies CSSProperties,
        [state.view.x, state.view.y, state.view.zoom]
    );

    // 修复设置按钮和切换深/浅色模式按钮导致文件修改
    function handleThemeChange(newTheme: "dark" | "light") {
        file.suppressDirtyRef.current = true;
        setTheme(newTheme);
        localStorage.setItem("dialogueEditor.theme", newTheme);
        file.suppressDirtyRef.current = false;
    }

    return (
        <>
            <TopBar
                theme={theme}
                setState={setState}
                windowSize={windowSize}
                fileMenuOpen={fileMenuOpen}
                setFileMenuOpen={setFileMenuOpen}
                handleOpenClick={file.handleOpenClick}
                handleSave={file.handleSave}
                handleSaveAs={file.handleSaveAs}
                fileMenuRef={fileMenuRef}
                isNewEmpty={file.isNewEmpty}
                fileInputRef={fileInputRef}
                onImport={file.onImport}
                handleThemeChange={handleThemeChange}
                setDraftProfile={setDraftProfile}
                codeProfile={codeProfile}
                defaultProfile={defaultProfile}
                setDraftProjectState={setDraftProjectState}
                state={state}
                setSettingsOpen={setSettingsOpen}
                viewMode={viewMode}
                setViewMode={setViewMode}
            />

            <div id="viewport" ref={viewportRef} style={{ display: viewMode === "graph" ? "block" : "none" }}>
                <canvas
                    id="line-canvas"
                    ref={lineCanvasRef}
                    style={{
                        position: 'absolute', top: 0, left: 0, pointerEvents: 'none',
                        zIndex: 0, width: "100%", height: "100%",
                    }}
                />
                <div id="content-layer" style={{ ...viewportTransformStyle, zIndex: 1 }}>
                    <div id="objects-container">
                        {state.comments.map(c =>
                            <CommentNode
                                key={c.id}
                                theme={theme}
                                c={c}
                                openCommentModal={editing.openCommentModal}
                                beginDrag={viewport.beginDrag}
                                beginTouchDrag={viewport.beginTouchDrag}
                                beginResize={viewport.beginResize}
                                beginTouchResize={viewport.beginTouchResize}
                            />
                        )}

                        {state.nodes.map((n) => {
                            const isConnecting = connectingFromId === n.id;
                            const isSelected = viewport.selectedNodeIds.length > 1 && viewport.selectedNodeIds.includes(n.id);

                            return (
                                <DraggableNode
                                    key={n.id}
                                    n={n}
                                    isSelected={isSelected}
                                    isConnecting={isConnecting}
                                    theme={theme}
                                    state={state}
                                    beginDrag={viewport.beginDrag}
                                    beginTouchDrag={viewport.beginTouchDrag}
                                    openModal={editing.openModal}
                                    setState={setState}
                                    setEdgeMenu={setEdgeMenu}
                                    setSortingEdgeNodeId={sorting.setSortingEdgeNodeId}
                                />
                            );
                        })}
                    </div>
                </div>
                <SelectionBox selectionBox={viewport.selectionBox} theme={theme} />
            </div>

            {viewMode === "text" ? (
                <TextViewPanel
                    theme={theme}
                    state={state}
                    selectedNodeIds={viewport.selectedNodeIds}
                    setState={setState}
                    onFocusGraphNode={(id) => {
                        setViewMode("graph");
                        setTick(t => t + 1);
                        viewport.setSelectedNodeIds([id]);
                        const node = stateRef.current.nodes.find((n) => n.id === id);
                        if (node) {
                            setState((prev) => ({
                                ...prev,
                                view: {
                                    ...prev.view,
                                    x: window.innerWidth / 2 - node.x * prev.view.zoom,
                                    y: window.innerHeight / 2 - node.y * prev.view.zoom,
                                },
                            }));
                        }
                    }}
                />
            ) : null}

            {viewMode === "graph" ? (
                <EdgeMenu
                    edgeMenu={edgeMenu}
                    state={state}
                    setState={setState}
                    setEdgeMenu={setEdgeMenu}
                    setSortingEdgeNodeId={sorting.setSortingEdgeNodeId}
                />
            ) : null}

            {/* 缩略图 */}
            {viewMode === "graph" ? (
                <MiniMap
                    zoomPercent={zoomPercent}
                    minimapSize={minimap.minimapSize}
                    minimapCanvasRef={minimapCanvasRef}
                    minimapMeta={minimap.minimapMeta}
                    minimapResizeRef={minimap.minimapResizeRef}
                    minimapViewStyle={minimap.minimapViewStyle}
                    setState={setState}
                />
            ) : null}

            {/* 节点编辑界面 */}
            {editing.editingCommentId !== null &&
                <EditingCommentWindows
                    commentDraft={editing.commentDraft}
                    setCommentDraft={editing.setCommentDraft}
                    commentColorDraft={editing.commentColorDraft}
                    setCommentColorDraft={editing.setCommentColorDraft}
                    deleteComment={editing.deleteComment}
                    closeCommentModal={editing.closeCommentModal}
                    saveCommentModal={editing.saveCommentModal}
                />
            }

            {editing.editingId !== null &&
                <EditingNodeWindows
                    theme={theme}
                    editingNode={editing.editingNode}
                    draft={editing.draft}
                    setDraft={editing.setDraft}
                    codeProfile={codeProfile}
                    deleteCurrent={editing.deleteCurrent}
                    closeModal={editing.closeModal}
                    saveModal={editing.saveModal}
                />
            }

            {/* 连线排序弹窗 */}
            {sorting.sortingEdgeNodeId !== null && (
                <SortableEdgeReorderModal
                    open={sorting.sortingEdgeNodeId !== null}
                    title={`节点 #${sorting.sortingEdgeNodeId} 连线排序`}
                    subtitle="拖动行上下调整顺序，顺序决定代码生成时的选择枝索引"
                    items={sorting.sortingEdgeList}
                    onClose={sorting.closeSortModal}
                    onCommit={(nextItems) => {
                        if (sorting.sortingEdgeNodeId === null) return;

                        setState((prev) => ({
                            ...prev,
                            edges: reorderEdgesByDefaultBranch(
                                prev.edges,
                                sorting.sortingEdgeNodeId,
                                nextItems
                            ),
                        }));
                    }}
                    getItemKey={(edge, index) =>
                        `${edge.fromId}-${edge.toId}-${edge.type ?? "default"}-${index}`
                    }
                    getItemLabel={(edge) => {
                        const targetNode = sorting.getTargetNode(edge.toId);
                        return `节点 #${targetNode?.id ?? "未知"}`;
                    }}
                    getItemSubLabel={(edge) => {
                        const targetNode = sorting.getTargetNode(edge.toId);
                        return targetNode?.type === "node"
                            ? `对话：${targetNode.cn || "无内容"}`
                            : targetNode?.type === "condition"
                            ? "条件"
                            : targetNode?.type === "start"
                            ? "开始"
                            : "结束";
                    }}
                />
            )}

            {settingsOpen && draftProfile && draftProjectState && (
                <SettingsOverlay
                    theme={theme}
                    settingsTab={settingsTab}
                    setSettingsTab={setSettingsTab}
                    draftProfile={draftProfile}
                    setDraftProfile={setDraftProfile}
                    codeProfile={codeProfile}
                    setCodeProfile={setCodeProfile}
                    state={state}
                    setState={setState}
                    draftProjectState={draftProjectState}
                    setDraftProjectState={setDraftProjectState}
                    setSettingsOpen={setSettingsOpen}
                    setDirty={file.setDirty}
                    fileInputRef={fileInputRef}
                    handleImport={handleImport}
                    handleExport={handleExport}
                />
            )}
        </>
    );
}
