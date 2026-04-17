import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Character, CommentBox, ConfigTabs, CustomVariable, DragTarget, Edge, EditorState, Node, ProjectData, Resizing } from "./editorTypes";
import { characterNone, createInitialState, defaultProfile } from "./editorTypes";
import { addObject, GRID_SIZE, hasEdge, makeGml, parseGmlEditorData, snapToGrid, startConnect } from "./editorLogic";
import CodeEditor, { type CodeStyleProfile } from "./CodeEditor";
import { AboutScreen } from "./config/About";
import { CodeConfigScreen } from "./config/CodeConfig";
import { CharacterScreen } from "./config/Character";
import { VariablesConfigScreen } from "./config/VariablesConfig";
import { ProjectInfoScreen } from "./config/ProjectInfo";
import { ConfigSidebar } from "./config/ConfigSidebar";
import { EditingCommentWindows, EditingNodeWindows } from "./components/EditingWindow";
import { MiniMap, MiniMapMeta, MiniMapResize, MiniMapSize, MiniMapViewStyle } from "./components/MiniMap";
import { TopBar } from "./components/TopBar";
import TextViewPanel from "./components/TextViewPanel";
import { DraggableNode } from "./components/Node";
import { CommentNode } from "./components/Comment";
import { reorderEdgesByDefaultBranch, SortableEdgeReorderModal } from "./components/ReorderList";

/**
 * 该文件是渲染进程主 UI：工具栏、工作区视口、节点/注释框渲染、连线绘制、
 * 缩略图（工作区快照）、文件打开/保存/另存为、主题切换与设置面板等。
 *
 * 设计原则：
 * - 尽量保持编辑器“状态”集中在 state（nodes/edges/comments/view 等）
 * - Canvas 负责连线与缩略图，DOM 负责交互与文本/表单
 * - Electron 环境下尽可能覆盖写回已打开文件；无句柄/路径时回退为下载导出
 */
export type ModalDraft = {
    cn: string;
    en: string;
    code: string;
    color: string;
    character: Character;
};

export const PRESET_COLORS = [
    "#7289da",
    "#e67e22",
    "#43b581",
    "#f04747",
    "#00a8ff",
    "#9b59b6",
    "#f1c40f",
    "#2c3e50",
];

type FileHandle = FileSystemFileHandle;
type ViewMode = "graph" | "text";
type SelectionBox = { x1: number; y1: number; x2: number; y2: number } | null;

function ensureGmlName(name: string): string {
    const trimmed = (name || "").trim();
    if (!trimmed) return "dialog_system.gml";
    return trimmed.toLowerCase().endsWith(".gml") ? trimmed : `${trimmed}.gml`;
}

function isFilePickerCancelled(err: unknown): boolean {
    const e = err as any;
    const name = typeof e?.name === "string" ? e.name : "";
    // File System Access API: user cancel is usually AbortError
    if (name === "AbortError" || name === "NotAllowedError") return true;
    // Sometimes DOMException uses a numeric code.
    if (typeof e?.code === "number" && e.code === 20) return true;
    return false;
}

export function hexToRgba(hex: string, alpha: number): string {
    const h = (hex || "").trim().replace("#", "");
    if (h.length === 3) {
        const r = parseInt(h[0] + h[0], 16);
        const g = parseInt(h[1] + h[1], 16);
        const b = parseInt(h[2] + h[2], 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    if (h.length >= 6) {
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return `rgba(0, 0, 0, ${alpha})`;
}

function clientToWorld(clientX: number, clientY: number, view: { x: number; y: number; zoom: number }): { x: number; y: number } {
    return {
        x: (clientX - view.x) / view.zoom,
        y: (clientY - view.y) / view.zoom,
    };
}

function normalizeClientRect(rect: SelectionBox): { left: number; top: number; right: number; bottom: number } | null {
    if (!rect) return null;
    return {
        left: Math.min(rect.x1, rect.x2),
        top: Math.min(rect.y1, rect.y2),
        right: Math.max(rect.x1, rect.x2),
        bottom: Math.max(rect.y1, rect.y2),
    };
}

function rectsIntersect(a: { left: number; top: number; right: number; bottom: number }, b: DOMRect): boolean {
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

export function getIpcRenderer(): any | null {
    try {
        const req = (window as any).require;
        if (typeof req !== "function") return null;
        const electron = req("electron");
        return electron?.ipcRenderer ?? null;
    } catch {
        return null;
    }
}
// ========== 修正后的getNodeAnchor函数 start ==========
function getNodeAnchor(
    from: { x: number; y: number; w: number; h: number },
    to: { x: number; y: number; w: number; h: number },
    isSource: boolean
): { x: number; y: number; nx: number; ny: number } {
    // 节点x,y已为中心坐标，无需额外计算宽高偏移
    const centerFrom = { x: from.x, y: from.y };
    const centerTo = { x: to.x, y: to.y };
    const dx = centerTo.x - centerFrom.x;
    const dy = centerTo.y - centerFrom.y;
    const horizontal = Math.abs(dx) > Math.abs(dy);

    if (isSource) {
        if (horizontal) {
            // 从右侧出 (nx: 1), 否则从左侧出 (nx: -1)
            return dx >= 0
                ? { x: from.x + from.w / 2, y: centerFrom.y, nx: 1, ny: 0 }
                : { x: from.x - from.w / 2, y: centerFrom.y, nx: -1, ny: 0 };
        }
        // 从底部出 (ny: 1), 否则从顶部出 (ny: -1)
        return dy >= 0
            ? { x: centerFrom.x, y: from.y + from.h / 2, nx: 0, ny: 1 }
            : { x: centerFrom.x, y: from.y - from.h / 2, nx: 0, ny: -1 };
    }

    // 对于目标节点 (Destination)，法线方向应该向外
    if (horizontal) {
        return dx >= 0
            ? { x: to.x - to.w / 2, y: centerTo.y, nx: -1, ny: 0 }
            : { x: to.x + to.w / 2, y: centerTo.y, nx: 1, ny: 0 };
    }
    return dy >= 0
        ? { x: centerTo.x, y: to.y - to.h / 2, nx: 0, ny: -1 }
        : { x: centerTo.x, y: to.y + to.h / 2, nx: 0, ny: 1 };
}
// ========== 修正后的getNodeAnchor函数 end ==========
// 计算两个触摸点的距离
function getTouchDistance(touch1: Touch, touch2: Touch): number {
    return Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);
}
// 计算两个触摸点的中心点
function getTouchCenter(touch1: Touch, touch2: Touch): { x: number; y: number } {
    return {
        x: (touch1.clientX + touch2.clientX) / 2,
        y: (touch1.clientY + touch2.clientY) / 2,
    };
}

export default function App() {
    const [state, setState] = useState<EditorState>(() => createInitialState());
    const [theme, setTheme] = useState<"dark" | "light">(localStorage.getItem("dialogueEditor.theme") === "light" ? "light" : "dark");
    const [currentFileName, setCurrentFileName] = useState<string>("新文件");
    const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
    const [currentFileHandle, setCurrentFileHandle] = useState<FileHandle | null>(null);
    const [isDirty, setDirty] = useState(false);
    const stateRef = useRef(state);
    const suppressDirtyRef = useRef(false);
    const firstStateRef = useRef(true);
    // ========== 新增：动画帧ref，用于控制缓动动画 ==========
    const animationFrameRef = useRef<number | null>(null);
    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    useEffect(() => {
        setSelectedNodeIds((prev) => prev.filter((id) => state.nodes.some((node) => node.id === id)));
    }, [state.nodes]);

    const [editingId, setEditingId] = useState<number | null>(null);
    const [draft, setDraft] = useState<ModalDraft>({ cn: "", en: "", code: "", color: "#7289da", character: characterNone });
    const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
    const [commentDraft, setCommentDraft] = useState<string>("");
    const [commentColorDraft, setCommentColorDraft] = useState<string>("#5865f2");
    const [viewMode, setViewMode] = useState<ViewMode>("graph");
    const [selectedNodeIds, setSelectedNodeIds] = useState<number[]>([]);
    const [selectionBox, setSelectionBox] = useState<SelectionBox>(null);
    const selectionDragRef = useRef<null | {
        started: boolean;
        additive: boolean;
        startX: number;
        startY: number;
    }>(null);
    const viewModeRef = useRef<ViewMode>("graph");
    useEffect(() => {
        viewModeRef.current = viewMode;
    }, [viewMode]);

    // 设置面板中的编辑状态
    const [draftProfile, setDraftProfile] = useState<CodeStyleProfile | null>(null);
    const [draftProjectState, setDraftProjectState] = useState<ProjectData | null>(null);

    // 触摸状态管理
    const touchStateRef = useRef({
        isTouching: false,
        isPinching: false,
        initialTouches: [] as Touch[],
        initialView: { x: 0, y: 0, zoom: 1 },
        initialDistance: 0,
        initialCenter: { x: 0, y: 0 },
        isTouchHandled: false, // 防止触摸事件后触发重复的鼠标事件
    });

    // 数据迁移和验证辅助函数
    const validateProfile = (p: any) => {
        if (!p.keywordGroups) p.keywordGroups = [];
        if (!p.characters) p.characters = [];
        if (p.rules && p.keywordGroups.length === 0) {
            p.keywordGroups = [{ id: "legacy", name: "旧版规则", colorLight: "#000000", colorDark: "#FFFFFF", keywords: p.rules.map((r: any) => r.pattern) }];
        }
        return p;
    };

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
        setDraftProfile(codeProfile);
    }, [codeProfile]);

    // 导出功能：将当前 draftProfile 以 JSON 格式保存到用户指定位置
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

    // 导入功能：将解析好的数据添加到 codeProfile 中
    const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
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

    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsJsonText, setSettingsJsonText] = useState<string>("");

    const viewportRef = useRef<HTMLDivElement | null>(null);
    const lineCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const fileMenuRef = useRef<HTMLDivElement | null>(null);
    const [fileMenuOpen, setFileMenuOpen] = useState(false);
    const [minimapSize, setMinimapSize] = useState<MiniMapSize>(() => ({ w: 260, h: 180 }));
    const minimapResizeRef = useRef<null | MiniMapResize>(null);
    const [edgeMenu, setEdgeMenu] = useState<null | { fromId: number; x: number; y: number }>(null);

    const [windowSize, setWindowSize] = useState(() => ({
        w: window.innerWidth,
        h: window.innerHeight,
    }));
    const zoomPercent = Math.round(state.view.zoom * 100);
    const isNewUntitled = currentFileName === "新文件" && !currentFilePath && !currentFileHandle;
    const hasWorkspaceContent =
        state.nodes.length > 0 || state.comments.length > 0 || state.edges.length > 0;
    const isNewEmpty = isNewUntitled && !hasWorkspaceContent;

    const [settingsTab, setSettingsTab] = useState<ConfigTabs>("info");
    const [tick, setTick] = useState(0);  // 窗口缩放监听

    const [sortingEdgeNodeId, setSortingEdgeNodeId] = useState<number | null>(null);
    const [sortDragState, setSortDragState] = useState<{
        draggingIndex: number | null;
        overIndex: number | null;
        dragY: number;
        dragHeight: number;
    }>({
        draggingIndex: null,
        overIndex: null,
        dragY: 0,
        dragHeight: 0,
    });

    // ========== 新增：组件卸载时清理动画帧 ==========
    useEffect(() => {
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, []);

    // ========== 新增：节点吸附缓动动画核心函数 ==========
    const animateNodeToSnapPosition = (
        nodes: Node[],
        targetNodes: Node[],
        enableSnap: boolean,
        onUpdate: (nodes: Node[]) => void,
        onComplete: () => void
    ) => {
        if (!enableSnap || animationFrameRef.current) return;

        const startTime = performance.now();
        const animationDuration = 150; // 动画时长，可根据手感调整
        const startNodes = [...nodes];

        // 构建每个节点的起始和目标坐标映射
        const nodeAnimations = startNodes.map((startNode) => {
            const targetNode = targetNodes.find(n => n.id === startNode.id);
            if (!targetNode) return null;
            return {
                id: startNode.id,
                startX: startNode.x,
                startY: startNode.y,
                endX: targetNode.x,
                endY: targetNode.y,
            };
        }).filter(Boolean) as {
            id: number;
            startX: number;
            startY: number;
            endX: number;
            endY: number;
        }[];

        // 无需要动画的节点，直接完成
        if (nodeAnimations.length === 0) {
            onComplete();
            return;
        }

        // 动画帧循环
        const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / animationDuration, 1);
            // ease-out缓动函数：越接近终点，速度越慢，手感更自然
            const easeProgress = 1 - Math.pow(1 - progress, 3);

            // 计算当前帧的节点坐标
            const updatedNodes = startNodes.map(node => {
                const anim = nodeAnimations.find(a => a.id === node.id);
                if (!anim) return node;
                const currentX = anim.startX + (anim.endX - anim.startX) * easeProgress;
                const currentY = anim.startY + (anim.endY - anim.startY) * easeProgress;
                return { ...node, x: currentX, y: currentY };
            });

            onUpdate(updatedNodes);

            if (progress < 1) {
                animationFrameRef.current = requestAnimationFrame(animate);
            } else {
                animationFrameRef.current = null;
                onComplete();
            }
        };

        animationFrameRef.current = requestAnimationFrame(animate);
    };

    useEffect(() => {
        const handleResize = () => setTick(t => t + 1);
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useLayoutEffect(() => {
        if (viewMode === "graph") {
            setTick((t) => t + 1);
        }
    }, [viewMode]);

    // 获取节点在屏幕上的真实宽高的辅助函数
    const getNodeBounds = (n: Node) => {
        const el = document.getElementById(`node-${n.id}`);
        return {
            x: n.x,
            y: n.y,
            w: el ? el.offsetWidth : 260, // 降级处理，默认260
            h: el ? el.offsetHeight : 120 // 降级处理，默认120
        };
    };

    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
    }, [theme]);

    useEffect(() => {
        console.log("Saving code profile:", codeProfile);
        localStorage.setItem("dialogueEditor.codeProfile", JSON.stringify(codeProfile));
    }, [codeProfile]);

    useEffect(() => {
        const root = document.documentElement;
        root.style.setProperty("--view-x", String(state.view.x));
        root.style.setProperty("--view-y", String(state.view.y));
        root.style.setProperty("--view-zoom", String(state.view.zoom));
    }, [state.view.x, state.view.y, state.view.zoom]);

    useEffect(() => {
        if (firstStateRef.current) {
            firstStateRef.current = false;
            return;
        }
        if (suppressDirtyRef.current) {
            suppressDirtyRef.current = false;
            return;
        }
        // 新文件且空白时，不认为是已修改（例如只做了平移/缩放）。
        if (isNewEmpty) return;
        setDirty(true);
    }, [state.nodes, state.edges, state.comments]);

    useEffect(() => {
        const titleName = currentFileName || "新文件";
        document.title = `${titleName}${isDirty ? "*" : ""} - 对话编辑器`;
    }, [currentFileName, isDirty]);

    useEffect(() => {
        const ipc = getIpcRenderer();
        if (!ipc) return;
        ipc.send("editor:dirty", { dirty: isDirty, fileName: currentFileName });
    }, [currentFileName, isDirty]);

    useEffect(() => {
        // 初始将视口移动到工作区中心
        setState((prev) => ({
            ...prev,
            view: {
                ...prev.view,
                x: window.innerWidth / 2 - 5000,
                y: window.innerHeight / 2 - 5000,
            },
        }));
    }, []);

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

    useEffect(() => {
        const onDown = () => {
            if (edgeMenu) setEdgeMenu(null);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [edgeMenu]);

    useEffect(() => {
        const onResize = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight });
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            const cur = minimapResizeRef.current;
            if (!cur) return;
            const minW = 200;
            const minH = 140;
            const maxW = 520;
            const maxH = 420;

            if (cur.edge === "left") {
                const dx = cur.ox - e.clientX;
                const nextW = Math.max(minW, Math.min(maxW, cur.w + dx));
                setMinimapSize((s) => ({ ...s, w: nextW }));
            } else {
                const dy = cur.oy - e.clientY;
                const nextH = Math.max(minH, Math.min(maxH, cur.h + dy));
                setMinimapSize((s) => ({ ...s, h: nextH }));
            }
        };
        const onUp = () => {
            minimapResizeRef.current = null;
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
    }, []);

    // Initialize canvas sizes.
    useEffect(() => {
        /* if (lineCanvasRef.current) {
            const dpr = window.devicePixelRatio || 1;
            const rect = lineCanvasRef.current.getBoundingClientRect();
            lineCanvasRef.current.width = rect.width * dpr;
            lineCanvasRef.current.height = rect.height * dpr;
        } */
        // 仅节点视图下初始化缩略图画布，避免非激活状态下尺寸错误
        if (minimapCanvasRef.current && viewMode === "graph") {
            const dpr = window.devicePixelRatio || 1;
            minimapCanvasRef.current.width = minimapSize.w * dpr;
            minimapCanvasRef.current.height = minimapSize.h * dpr;
        }
    }, [minimapSize.h, minimapSize.w, viewMode, windowSize, tick]);

    const connectingFromId = state.connecting?.fromId ?? null;

    const minimapMeta = useMemo<MiniMapMeta>(() => {
        const W = minimapSize.w;
        const H = minimapSize.h;
        const pad = 10;

        let minX = 0;
        let minY = 0;
        let maxX = 10000;
        let maxY = 10000;

        if (state.nodes.length || state.comments.length) {
            minX = Number.POSITIVE_INFINITY;
            minY = Number.POSITIVE_INFINITY;
            maxX = Number.NEGATIVE_INFINITY;
            maxY = Number.NEGATIVE_INFINITY;

            state.nodes.forEach((n) => {
                const el = document.getElementById(`node-${n.id}`);
                const w = el ? el.offsetWidth : 260;
                const h = el ? el.offsetHeight : 120;
                // 适配中心坐标，计算节点实际边界
                minX = Math.min(minX, n.x - w/2);
                minY = Math.min(minY, n.y - h/2);
                maxX = Math.max(maxX, n.x + w/2);
                maxY = Math.max(maxY, n.y + h/2);
            });
            state.comments.forEach((c) => {
                minX = Math.min(minX, c.x);
                minY = Math.min(minY, c.y);
                maxX = Math.max(maxX, c.x + c.w);
                maxY = Math.max(maxY, c.y + c.h);
            });

            if (!Number.isFinite(minX)) {
                minX = 0;
                minY = 0;
                maxX = 10000;
                maxY = 10000;
            }
        }

        const spanX = Math.max(1, maxX - minX);
        const spanY = Math.max(1, maxY - minY);
        const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
        const contentWidth = spanX * scale;
        const contentHeight = spanY * scale;
        const offsetX = (W - contentWidth) / 2 - minX * scale;
        const offsetY = (H - contentHeight) / 2 - minY * scale;

        // Visible world rect.
        const worldLeft = -state.view.x / state.view.zoom;
        const worldTop = -state.view.y / state.view.zoom;
        const worldW = windowSize.w / state.view.zoom;
        const worldH = windowSize.h / state.view.zoom;
        const viewLeft = worldLeft * scale + offsetX;
        const viewTop = worldTop * scale + offsetY;
        const viewW = worldW * scale;
        const viewH = worldH * scale;

        return {
            W,
            H,
            scale,
            offsetX,
            offsetY,
            bounds: { minX, minY, maxX, maxY },
            viewRect: { left: viewLeft, top: viewTop, width: viewW, height: viewH },
        };
    }, [
        minimapSize.h, minimapSize.w,
        state.nodes, state.comments, state.view.x, state.view.y, state.view.zoom,
        windowSize.w, windowSize.h,
        tick, viewMode,
    ]);

    const minimapViewStyle = useMemo<MiniMapViewStyle>(
        () =>
            ({
                width: minimapMeta.viewRect.width + "px",
                height: minimapMeta.viewRect.height + "px",
                left: minimapMeta.viewRect.left + "px",
                top: minimapMeta.viewRect.top + "px",
            }) satisfies React.CSSProperties,
        [
            minimapMeta.viewRect.height,
            minimapMeta.viewRect.left,
            minimapMeta.viewRect.top,
            minimapMeta.viewRect.width,
        ]
    );

    // Draw edges whenever nodes/edges change.
    useLayoutEffect(() => {
        if (viewMode !== "graph") return;
        const canvas = lineCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        // 直接获取画布当前的布局尺寸
        const rect = canvas.getBoundingClientRect();
        const logicalWidth = rect.width || window.innerWidth;
        const logicalHeight = rect.height || window.innerHeight;

        // 使用 Math.round 确保像素对齐，且只更新属性，不碰 style
        const targetBufferWidth = Math.round(logicalWidth * dpr);
        const targetBufferHeight = Math.round(logicalHeight * dpr);
        if (canvas.width !== targetBufferWidth || canvas.height !== targetBufferHeight) {
            canvas.width = targetBufferWidth;
            canvas.height = targetBufferHeight;
        }

        // 重置变换并缩放，确保后续绘图指令按逻辑像素执行
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);

        // 清除画布（注意由于已经 scale 了，这里传逻辑尺寸即可）
        ctx.clearRect(0, 0, logicalWidth, logicalHeight);
        const { x: vX, y: vY, zoom } = state.view;
        const worldToScreen = (wx: number, wy: number) => ({
            x: wx * zoom + vX,
            y: wy * zoom + vY
        });

        // 优化为商业质感的飞镖形箭头
        const drawArrowHead = (ctx: CanvasRenderingContext2D, tipX: number, tipY: number, angleRad: number, size: number) => {
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            // 绘制左右两翼
            ctx.lineTo(tipX - size * Math.cos(angleRad - Math.PI / 7), tipY - size * Math.sin(angleRad - Math.PI / 7));
            // 尾部向内凹陷，形成飞镖质感
            ctx.lineTo(tipX - size * 0.6 * Math.cos(angleRad), tipY - size * 0.6 * Math.sin(angleRad));
            ctx.lineTo(tipX - size * Math.cos(angleRad + Math.PI / 7), tipY - size * Math.sin(angleRad + Math.PI / 7));
            ctx.closePath();
            ctx.fill();
        };

        state.edges.forEach((edge) => {
            const from = state.nodes.find((n) => n.id === edge.fromId);
            const to = state.nodes.find((n) => n.id === edge.toId);
            if (!from || !to) return;

            // 获取带真实宽高的对象
            const fromBounds = getNodeBounds(from);
            const toBounds = getNodeBounds(to);

            // 传入 bounds 计算锚点
            const startW = getNodeAnchor(fromBounds, toBounds, true);
            const endW = getNodeAnchor(fromBounds, toBounds, false);
            const start = worldToScreen(startW.x, startW.y);
            const end = worldToScreen(endW.x, endW.y);

            // 距离用于动态决定曲线的弯曲强度
            const dist = Math.hypot(end.x - start.x, end.y - start.y);

            // 商业软件的精髓：设置最小弯曲强度，即便节点挨得很近，线也是圆润的而不会变成死板的直线
            const minCurve = 60 * zoom;
            const maxCurve = 250 * zoom;
            const curveStrength = Math.min(maxCurve, Math.max(minCurve, dist * 0.4));

            // 基于法线方向 (nx, ny) 延伸控制点，告别之前的 horizontal 乱跳问题
            const cp1X = start.x + startW.nx * curveStrength;
            const cp1Y = start.y + startW.ny * curveStrength;
            const cp2X = end.x + endW.nx * curveStrength;
            const cp2Y = end.y + endW.ny * curveStrength;

            // 绘制平滑曲线
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, end.x, end.y);

            if (edge.type === "true") ctx.strokeStyle = "#43b581";
            else if (edge.type === "false") ctx.strokeStyle = "#f04747";
            else ctx.strokeStyle = from.color;

            ctx.lineWidth = Math.max(1, 3 * zoom);
            ctx.lineCap = "round";
            ctx.stroke();

            // 计算终点切线角度，绘制箭头
            ctx.fillStyle = ctx.strokeStyle as string;
            // 终点的切线方向由第二个控制点 (cp2) 指向终点 (end) 决定
            const tanX = end.x - cp2X;
            const tanY = end.y - cp2Y;
            const angle = Math.atan2(tanY, tanX);

            drawArrowHead(ctx, end.x, end.y, angle, 18 * zoom);
        });
    }, [state.edges, state.nodes, state.view, windowSize, tick, viewMode, ]);

    // Draw minimap: render a scaled snapshot of the current workspace.
    useEffect(() => {
        const canvas = minimapCanvasRef.current;
        if (!canvas || viewMode !== "graph") return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const W = minimapMeta.W;
        const H = minimapMeta.H;
        const { scale, offsetX, offsetY } = minimapMeta;

        // Reset transform and clear using physical pixels.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Draw in CSS pixels.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Background
        ctx.fillStyle = theme === "light" ? "#f8fafc" : "rgba(0,0,0,0.55)";
        ctx.fillRect(0, 0, W, H);

        // Grid (based on main grid spacing)
        const worldGrid = GRID_SIZE;
        const miniGrid = worldGrid * scale;
        const gridStep = Math.max(4, Math.min(14, miniGrid));
        const dot = theme === "light" ? "rgba(148,163,184,0.55)" : "rgba(148,163,184,0.35)";
        ctx.fillStyle = dot;
        const xStart = 0;
        const yStart = 0;
        for (let x = xStart; x <= W; x += gridStep) {
            for (let y = yStart; y <= H; y += gridStep) {
                ctx.fillRect(x, y, 1, 1);
            }
        }

        const worldToMini = (x: number, y: number) => ({
            x: x * scale + offsetX,
            y: y * scale + offsetY,
        });

        const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
            w = Math.max(0, w);
            h = Math.max(0, h);
            const rr = Math.min(r, w / 2, h / 2);

            ctx.beginPath();
            ctx.moveTo(x + rr, y);
            ctx.arcTo(x + w, y, x + w, y + h, rr);
            ctx.arcTo(x + w, y + h, x, y + h, rr);
            ctx.arcTo(x, y + h, x, y, rr);
            ctx.arcTo(x, y, x + w, y, rr);
            ctx.closePath();
        };
        // ========== 修正后的drawNode函数 start ==========
        const drawNode = (n: Node, isConnecting: boolean) => {
            const bounds = getNodeBounds(n); // 获取真实尺寸
            // 节点x,y为中心坐标，绘制时偏移到左上角
            const { x: centerX, y: centerY } = worldToMini(n.x, n.y);
            const w = bounds.w * scale;
            const h = bounds.h * scale;
            const x = centerX - w / 2;
            const y = centerY - h / 2;

            const r = (n.type === "start" ? 100 : 10) * scale;
            const headerH = 30 * scale;
            const footerH = 26 * scale;

            // Node body
            ctx.fillStyle = theme === "light" ? "#ffffff" : "#2f3136";
            roundRect(x, y, w, h, r);
            ctx.fill();

            // Border
            ctx.lineWidth = Math.max(1, 2 * scale);
            ctx.strokeStyle = n.color;
            ctx.stroke();

            if (n.type !== "start")
            {
                // Header stripe
                ctx.fillStyle = theme === "light" ? "rgba(59,130,246,0.06)" : "rgba(255,255,255,0.06)";
                ctx.fillRect(x, y, w, headerH);

                // Footer stripe
                ctx.fillStyle = theme === "light" ? "rgba(59,130,246,0.05)" : "rgba(255,255,255,0.04)";
                ctx.fillRect(x, y + h - footerH, w, footerH);
            }

            // Ports (small indicators)
            const portY = y + h - footerH + footerH / 2;
            if (n.type === "condition") {
                const leftX = x + w * 0.25;
                const rightX = x + w * 0.75;
                ctx.fillStyle = hasEdge(state, n.id, "true") ? "#43b581" : n.color;
                ctx.beginPath();
                ctx.arc(leftX, portY, Math.max(1.5, 3.5 * scale), 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = hasEdge(state, n.id, "false") ? "#f04747" : n.color;
                ctx.beginPath();
                ctx.arc(rightX, portY, Math.max(1.5, 3.5 * scale), 0, Math.PI * 2);
                ctx.fill();
            } else {
                const midX = x + w * 0.5;
                ctx.fillStyle = isConnecting ? "#f1c40f" : n.color;
                ctx.beginPath();
                ctx.arc(midX, portY, Math.max(1.5, 3.5 * scale), 0, Math.PI * 2);
                ctx.fill();
            }
        };

        // ========== 修正后的drawNode函数 end ==========
        const drawComment = (c: CommentBox) => {
            const { x, y } = worldToMini(c.x, c.y);
            const w = c.w * scale;
            const h = c.h * scale;
            const r = 6 * scale;

            // Fill (transparent)
            ctx.fillStyle = `${c.color}19`;
            roundRect(x, y, w, h, r);
            ctx.fill();

            // Border dashed
            ctx.setLineDash([6 * scale, 5 * scale]);
            ctx.lineWidth = Math.max(1, 2 * scale);
            ctx.strokeStyle = c.color;
            ctx.stroke();
            ctx.setLineDash([]);

            // Handle
            const handleH = 18 * scale;
            const handleY = y - 28 * scale;
            const handleW = Math.max(30 * scale, w * 0.6);
            ctx.fillStyle = c.color;
            ctx.strokeStyle = c.color;
            ctx.lineWidth = Math.max(1, 1.5 * scale);
            roundRect(x, handleY, handleW, handleH, 6 * scale);
            ctx.fill();
            ctx.stroke();
        };

        const drawEdge = (edge: Edge) => {
            const fromNode = state.nodes.find((n) => n.id === edge.fromId);
            const toNode = state.nodes.find((n) => n.id === edge.toId);
            if (!fromNode || !toNode) return;

            const fromBounds = getNodeBounds(fromNode);
            const toBounds = getNodeBounds(toNode);
            const startW = getNodeAnchor(fromBounds, toBounds, true);
            const endW = getNodeAnchor(fromBounds, toBounds, false);

            // 映射到缩略图坐标
            const startMini = worldToMini(startW.x, startW.y);
            const endMini = worldToMini(endW.x, endW.y);

            // 计算缩略图中的弯曲强度 (根据缩略图距离动态调整)
            const dx = endMini.x - startMini.x;
            const dy = endMini.y - startMini.y;
            const dist = Math.hypot(dx, dy);

            // 缩略图尺度较小，我们将 min/max 强度调小 (对应主画布的 60-250)
            // 使用刚才主画布同样的比例逻辑，但映射到缩略图的尺度
            const minCurve = 15;
            const maxCurve = 60;
            const curveStrength = Math.min(maxCurve, Math.max(minCurve, dist * 0.4));

            // 使用法向 (nx, ny) 计算控制点
            const cp1X = startMini.x + startW.nx * curveStrength;
            const cp1Y = startMini.y + startW.ny * curveStrength;
            const cp2X = endMini.x + endW.nx * curveStrength;
            const cp2Y = endMini.y + endW.ny * curveStrength;

            // 绘制贝塞尔曲线
            ctx.beginPath();
            ctx.moveTo(startMini.x, startMini.y);
            ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, endMini.x, endMini.y);

            ctx.strokeStyle =
                edge.type === "true" ? "#43b581" : 
                edge.type === "false" ? "#f04747" : fromNode.color;
            ctx.lineWidth = Math.max(1, 2 * scale);
            ctx.lineCap = "round";
            ctx.stroke();

            // 绘制商业级“飞镖”箭头
            ctx.fillStyle = ctx.strokeStyle;
            const tanX = endMini.x - cp2X;
            const tanY = endMini.y - cp2Y;
            const angle = Math.atan2(tanY, tanX);

            // 缩略图箭头尺寸建议略小一点，避免遮挡
            const arrowSize = Math.max(5, 10 * scale);

            ctx.beginPath();
            ctx.moveTo(endMini.x, endMini.y);
            // 左翼
            ctx.lineTo(
                endMini.x - arrowSize * Math.cos(angle - Math.PI / 7),
                endMini.y - arrowSize * Math.sin(angle - Math.PI / 7)
            );
            // 尾部凹陷点 (中心线向回缩进)
            ctx.lineTo(
                endMini.x - arrowSize * 0.6 * Math.cos(angle),
                endMini.y - arrowSize * 0.6 * Math.sin(angle)
            );
            // 右翼
            ctx.lineTo(
                endMini.x - arrowSize * Math.cos(angle + Math.PI / 7),
                endMini.y - arrowSize * Math.sin(angle + Math.PI / 7)
            );
            ctx.closePath();
            ctx.fill();
        };

        // Comment boxes (behind edges)
        state.comments.forEach(drawComment);
        // Edges
        state.edges.forEach(drawEdge);
        // Nodes (front)
        state.nodes.forEach((n) => drawNode(n, connectingFromId === n.id));
    }, [
        state.nodes, state.comments, state.edges,
        minimapMeta, theme, connectingFromId, tick
    ]);

    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;

        const isInteractiveTarget = (target: EventTarget | null) => {
            if (!(target instanceof HTMLElement)) return false;
            // 仅注释框的拖拽把手、缩放器视为交互目标，文本区域放行文本选中
            const closestComment = target.closest(".comment-box");
            if (closestComment) {
                return !!target.closest(".comment-handle, .comment-resizer");
            }
            return !!target.closest(
                ".node, .port, .file-menu, #toolbar"
            );
        };

        const onMouseDown = (e: MouseEvent) => {
            if (touchStateRef.current.isTouchHandled) return;

            // Middle mouse button panning.
            if (e.button === 1) {
                e.preventDefault();
                selectionDragRef.current = null;
                setSelectionBox(null);
                setState((prev) => ({
                    ...prev,
                    isPanning: true,
                    lastMouse: { x: e.clientX, y: e.clientY },
                    dragTarget: null,
                    resizing: null,
                }));
                return;
            }

            if (e.button === 0 && viewModeRef.current === "graph" && !isInteractiveTarget(e.target)) {
                const additive = e.shiftKey;
                selectionDragRef.current = {
                    started: false,
                    additive,
                    startX: e.clientX,
                    startY: e.clientY,
                };
                setSelectionBox({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY });
                setState((prev) => ({
                    ...prev,
                    isPanning: false,
                    lastMouse: undefined,
                    dragTarget: null,
                    resizing: null,
                }));
            }
        };
        
        const onMouseMove = (e: MouseEvent) => {
            if (touchStateRef.current.isTouchHandled) return;
            
            const selectionDrag = selectionDragRef.current;
            if (selectionDrag) {
                selectionDrag.started = true;
                setSelectionBox({
                    x1: selectionDrag.startX,
                    y1: selectionDrag.startY,
                    x2: e.clientX,
                    y2: e.clientY,
                });
            }

            setState((prev) => {
                let next = prev;
                if (prev.isPanning && prev.lastMouse) {
                    next = {
                        ...next,
                        view: {
                            ...next.view,
                            x: next.view.x + (e.clientX - prev.lastMouse.x),
                            y: next.view.y + (e.clientY - prev.lastMouse.y),
                        },
                        lastMouse: { x: e.clientX, y: e.clientY },
                    };
                }
                if (prev.dragTarget) {
                    const drag = prev.dragTarget;
                    const dx = (e.clientX - drag.ox) / prev.view.zoom;
                    const dy = (e.clientY - drag.oy) / prev.view.zoom;
                    const enableSnap = prev.enableSnapToGrid;
                    if (drag.kind === "node") {
                        // 单个节点：拖拽时平滑吸附网格，避免生硬跳格
                        const node = prev.nodes.find(n => n.id === drag.id);
                        if (node) {
                            const totalDx = (e.clientX - drag.ox) / prev.view.zoom;
                            const totalDy = (e.clientY - drag.oy) / prev.view.zoom;
                            const rawX = (drag.startX || drag.ox) + totalDx;
                            const rawY = (drag.startY || drag.oy) + totalDy;
                            // 计算吸附目标坐标
                            const targetX = enableSnap ? snapToGrid(rawX, enableSnap) : rawX;
                            const targetY = enableSnap ? snapToGrid(rawY, enableSnap) : rawY;
                            // 缓动系数：0.7-0.9手感最佳，越接近1越跟手，越接近0越顺滑
                            const easeFactor = 0.75;
                            // 线性插值实现平滑过渡，替代硬跳转
                            const smoothX = node.x + (targetX - node.x) * easeFactor;
                            const smoothY = node.y + (targetY - node.y) * easeFactor;
                            next = {
                                ...next,
                                nodes: next.nodes.map((n) =>
                                    n.id === drag.id ? { ...n, x: smoothX, y: smoothY } : n
                                ),
                                dragTarget: drag,
                            };
                        }
                    } else if (drag.kind === "nodeGroup") {
                        // 多选节点：拖拽时平滑吸附网格
                        next = {
                            ...next,
                            nodes: next.nodes.map((n) => {
                                const start = drag.positions[n.id];
                                if (start) {
                                    const rawX = start.x + dx;
                                    const rawY = start.y + dy;
                                    const targetX = enableSnap ? snapToGrid(rawX, enableSnap) : rawX;
                                    const targetY = enableSnap ? snapToGrid(rawY, enableSnap) : rawY;
                                    const easeFactor = 0.75;
                                    const smoothX = n.x + (targetX - n.x) * easeFactor;
                                    const smoothY = n.y + (targetY - n.y) * easeFactor;
                                    return { ...n, x: smoothX, y: smoothY };
                                }
                                return n;
                            }),
                            dragTarget: drag,
                        };
                    } else if (drag.kind === "comment") {
                        // 注释框：拖拽时平滑吸附网格，和节点逻辑完全对齐
                        const comment = prev.comments.find(c => c.id === drag.id);
                        if (comment) {
                            const totalDx = (e.clientX - drag.ox) / prev.view.zoom;
                            const totalDy = (e.clientY - drag.oy) / prev.view.zoom;
                            const rawX = (drag.startX || drag.ox) + totalDx;
                            const rawY = (drag.startY || drag.oy) + totalDy;
                            // 计算吸附目标坐标
                            const targetX = enableSnap ? snapToGrid(rawX, enableSnap) : rawX;
                            const targetY = enableSnap ? snapToGrid(rawY, enableSnap) : rawY;
                            // 和节点一致的缓动系数，平滑过渡
                            const easeFactor = 0.75;
                            const smoothX = comment.x + (targetX - comment.x) * easeFactor;
                            const smoothY = comment.y + (targetY - comment.y) * easeFactor;
                            next = {
                                ...next,
                                comments: next.comments.map((c) =>
                                    c.id === drag.id ? { ...c, x: smoothX, y: smoothY } : c
                                ),
                                dragTarget: drag, // 不更新ox/oy，和节点逻辑一致，避免基准偏移
                            };
                        }
                    }
                }
                if (prev.resizing) {
                    const zoom = prev.view.zoom;
                    const deltaW = (e.clientX - prev.resizing.ox) / zoom;
                    const deltaH = (e.clientY - prev.resizing.oy) / zoom;
                    next = {
                        ...next,
                        comments: next.comments.map((c) =>
                            c.id === prev.resizing!.id
                                ? {
                                    ...c,
                                    w: prev.resizing!.startW + deltaW,
                                    h: prev.resizing!.startH + deltaH,
                                }
                                : c
                        ),
                    };
                }
                return next;
            });
        };
        
        const onMouseUp = (e: MouseEvent) => {
            if (touchStateRef.current.isTouchHandled) return;
            
            const selectionDrag = selectionDragRef.current;
            if (selectionDrag) {
                const rect = normalizeClientRect({
                    x1: selectionDrag.startX,
                    y1: selectionDrag.startY,
                    x2: e.clientX,
                    y2: e.clientY,
                });
                if (rect) {
                    const hitIds = stateRef.current.nodes
                        .filter((node) => {
                            const el = document.getElementById(`node-${node.id}`);
                            return el ? rectsIntersect(rect, el.getBoundingClientRect()) : false;
                        })
                        .map((node) => node.id);
                    setSelectedNodeIds((prev) => {
                        if (selectionDrag.additive) {
                            return Array.from(new Set([...prev, ...hitIds]));
                        }
                        return hitIds;
                    });
                }
                selectionDragRef.current = null;
                setSelectionBox(null);
            }

            // 拖拽结束，执行最终缓动吸附动画，保证节点精准对齐网格
            const currentState = stateRef.current;
            const dragTarget = currentState.dragTarget;
            const enableSnap = currentState.enableSnapToGrid;
            if (dragTarget && enableSnap) {
                // 处理节点/节点组
                if (dragTarget.kind === "node" || dragTarget.kind === "nodeGroup") {
                    let targetNodes = [...currentState.nodes];
                    if (dragTarget.kind === "node") {
                        targetNodes = targetNodes.map(node => {
                            if (node.id === dragTarget.id) {
                                return {
                                    ...node,
                                    x: snapToGrid(node.x, enableSnap),
                                    y: snapToGrid(node.y, enableSnap),
                                };
                            }
                            return node;
                        });
                    } else if (dragTarget.kind === "nodeGroup") {
                        targetNodes = targetNodes.map(node => {
                            if (dragTarget.ids.includes(node.id)) {
                                return {
                                    ...node,
                                    x: snapToGrid(node.x, enableSnap),
                                    y: snapToGrid(node.y, enableSnap),
                                };
                            }
                            return node;
                        });
                    }
                    animateNodeToSnapPosition(
                        currentState.nodes,
                        targetNodes,
                        enableSnap,
                        (updatedNodes) => setState(prev => ({ ...prev, nodes: updatedNodes })),
                        () => {
                            setState(prev => ({
                                ...prev,
                                isPanning: false,
                                lastMouse: undefined,
                                dragTarget: null,
                                resizing: null,
                            }));
                        }
                    );
                }
                // 处理注释框
                else if (dragTarget.kind === "comment") {
                    const comment = currentState.comments.find(c => c.id === dragTarget.id);
                    if (comment) {
                        const startTime = performance.now();
                        const animationDuration = 150;
                        const startX = comment.x;
                        const startY = comment.y;
                        const endX = snapToGrid(comment.x, enableSnap);
                        const endY = snapToGrid(comment.y, enableSnap);

                        const animateComment = (currentTime: number) => {
                            const elapsed = currentTime - startTime;
                            const progress = Math.min(elapsed / animationDuration, 1);
                            const easeProgress = 1 - Math.pow(1 - progress, 3);
                            const currentX = startX + (endX - startX) * easeProgress;
                            const currentY = startY + (endY - startY) * easeProgress;

                            setState(prev => ({
                                ...prev,
                                comments: prev.comments.map(c => 
                                    c.id === dragTarget.id ? { ...c, x: currentX, y: currentY } : c
                                )
                            }));

                            if (progress < 1) {
                                animationFrameRef.current = requestAnimationFrame(animateComment);
                            } else {
                                animationFrameRef.current = null;
                                setState(prev => ({
                                    ...prev,
                                    isPanning: false,
                                    lastMouse: undefined,
                                    dragTarget: null,
                                    resizing: null,
                                }));
                            }
                        };
                        animationFrameRef.current = requestAnimationFrame(animateComment);
                    }
                }
            } else {
                setState((prev) => ({
                    ...prev,
                    isPanning: false,
                    lastMouse: undefined,
                    dragTarget: null,
                    resizing: null,
                }));
            }
        };
        // ========== 修正后的onMouseUp事件 end ==========
        const onWheel = (e: WheelEvent) => {
            if (touchStateRef.current.isTouchHandled) return;

            e.preventDefault();
            setState((prev) => {
                const delta = e.deltaY > 0 ? 0.9 : 1.1;
                const nextZoom = Math.min(Math.max(0.1, prev.view.zoom * delta), 2);

                // Zoom to mouse point.
                const mouseX = (e.clientX - prev.view.x) / prev.view.zoom;
                const mouseY = (e.clientY - prev.view.y) / prev.view.zoom;

                return {
                    ...prev,
                    view: {
                        zoom: nextZoom,
                        x: e.clientX - mouseX * nextZoom,
                        y: e.clientY - mouseY * nextZoom,
                    },
                };
            });
        };

        viewport.addEventListener("mousedown", onMouseDown);
        viewport.addEventListener("wheel", onWheel, { passive: false });
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);

        return () => {
            viewport.removeEventListener("mousedown", onMouseDown);
            viewport.removeEventListener("wheel", onWheel as any);
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }, []);

    // ========== 触摸屏核心事件监听 ==========
    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const touchState = touchStateRef.current;

        // 触摸开始
        const onTouchStart = (e: TouchEvent) => {
            e.stopPropagation();
            touchState.isTouchHandled = true;
            touchState.isTouching = true;
            const touches = e.touches;

            // 双指触摸：进入捏合缩放模式
            if (touches.length === 2) {
                e.preventDefault();
                touchState.isPinching = true;
                touchState.initialTouches = [touches[0], touches[1]];
                touchState.initialDistance = getTouchDistance(touches[0], touches[1]);
                touchState.initialCenter = getTouchCenter(touches[0], touches[1]);
                touchState.initialView = { ...stateRef.current.view };
                // 清空拖拽状态，避免冲突
                setState(prev => ({ ...prev, dragTarget: null, isPanning: false }));
                return;
            }

            // 单指触摸：判断是否拖拽元素，否则平移视口
            if (touches.length === 1) {
                const touch = touches[0];
                const target = touch.target as HTMLElement;

                // 触摸在可拖拽元素上（节点header/注释handle），不做视口平移
                const isDragTarget = 
                    target.closest('.node-header') || 
                    target.closest('.comment-handle') ||
                    target.closest('.comment-resizer');
                
                if (!isDragTarget) {
                    e.preventDefault();
                    // 进入视口平移模式
                    setState(prev => ({
                        ...prev,
                        isPanning: true,
                        lastMouse: { x: touch.clientX, y: touch.clientY }
                    }));
                }
            }
        };

        // 触摸移动
        const onTouchMove = (e: TouchEvent) => {
            const touches = e.touches;
            const touchState = touchStateRef.current;

            // 双指捏合缩放+平移
            if (touchState.isPinching && touches.length === 2) {
                e.preventDefault();
                const [touch1, touch2] = touches;
                const currentDistance = getTouchDistance(touch1, touch2);
                const currentCenter = getTouchCenter(touch1, touch2);
                
                // 计算缩放比例
                const scaleRatio = currentDistance / touchState.initialDistance;
                const nextZoom = Math.min(Math.max(0.1, touchState.initialView.zoom * scaleRatio), 2);

                // 计算中心点偏移（双指平移）
                const centerDx = currentCenter.x - touchState.initialCenter.x;
                const centerDy = currentCenter.y - touchState.initialCenter.y;

                // 基于中心点的缩放锚点计算（和滚轮缩放逻辑一致，避免画面跳动）
                const centerWorldX = (touchState.initialCenter.x - touchState.initialView.x) / touchState.initialView.zoom;
                const centerWorldY = (touchState.initialCenter.y - touchState.initialView.y) / touchState.initialView.zoom;
                const newViewX = currentCenter.x - centerWorldX * nextZoom + centerDx;
                const newViewY = currentCenter.y - centerWorldY * nextZoom + centerDy;

                setState(prev => ({
                    ...prev,
                    view: {
                        zoom: nextZoom,
                        x: newViewX,
                        y: newViewY
                    }
                }));
                return;
            }

            // 单指视口平移
            if (touches.length === 1) {
                e.preventDefault();
                const touch = touches[0];
                const currentState = stateRef.current;
                
                // 处理节点触摸拖拽+实时吸附
                if (currentState.dragTarget) {
                    const drag = currentState.dragTarget;
                    const zoom = currentState.view.zoom;
                    const enableSnap = currentState.enableSnapToGrid;
                    const dx = (touch.clientX - drag.ox) / zoom;
                    const dy = (touch.clientY - drag.oy) / zoom;

                    setState(prev => {
                        let next = prev;
                        if (drag.kind === "node") {
                            // 单个节点触摸拖拽，平滑吸附网格
                            const node = prev.nodes.find(n => n.id === drag.id);
                            if (node) {
                                const totalDx = (touch.clientX - drag.ox) / prev.view.zoom;
                                const totalDy = (touch.clientY - drag.oy) / prev.view.zoom;
                                const rawX = (drag.startX || drag.ox) + totalDx;
                                const rawY = (drag.startY || drag.oy) + totalDy;
                                const targetX = enableSnap ? snapToGrid(rawX, enableSnap) : rawX;
                                const targetY = enableSnap ? snapToGrid(rawY, enableSnap) : rawY;
                                // 触摸端缓动系数调小，手感更顺滑
                                const easeFactor = 0.7;
                                const smoothX = node.x + (targetX - node.x) * easeFactor;
                                const smoothY = node.y + (targetY - node.y) * easeFactor;
                                next = {
                                    ...next,
                                    nodes: next.nodes.map((n) =>
                                        n.id === drag.id ? { ...n, x: smoothX, y: smoothY } : n
                                    ),
                                    dragTarget: drag,
                                };
                            }
                        } else if (drag.kind === "nodeGroup") {
                            // 多选节点触摸拖拽，平滑吸附网格
                            next = {
                                ...next,
                                nodes: next.nodes.map((n) => {
                                    const start = drag.positions[n.id];
                                    if (start) {
                                        const rawX = start.x + dx;
                                        const rawY = start.y + dy;
                                        const targetX = enableSnap ? snapToGrid(rawX, enableSnap) : rawX;
                                        const targetY = enableSnap ? snapToGrid(rawY, enableSnap) : rawY;
                                        const easeFactor = 0.7;
                                        const smoothX = n.x + (targetX - n.x) * easeFactor;
                                        const smoothY = n.y + (targetY - n.y) * easeFactor;
                                        return { ...n, x: smoothX, y: smoothY };
                                    }
                                    return n;
                                }),
                                dragTarget: drag,
                            };
                        } else if (drag.kind === "comment") {
                            // 注释框触摸拖拽，平滑吸附网格，和节点逻辑对齐
                            const comment = prev.comments.find(c => c.id === drag.id);
                            if (comment) {
                                const totalDx = (touch.clientX - drag.ox) / prev.view.zoom;
                                const totalDy = (touch.clientY - drag.oy) / prev.view.zoom;
                                const rawX = (drag.startX || drag.ox) + totalDx;
                                const rawY = (drag.startY || drag.oy) + totalDy;
                                const targetX = enableSnap ? snapToGrid(rawX, enableSnap) : rawX;
                                const targetY = enableSnap ? snapToGrid(rawY, enableSnap) : rawY;
                                // 触摸端和节点一致的缓动系数
                                const easeFactor = 0.7;
                                const smoothX = comment.x + (targetX - comment.x) * easeFactor;
                                const smoothY = comment.y + (targetY - comment.y) * easeFactor;
                                next = {
                                    ...next,
                                    comments: next.comments.map((c) =>
                                        c.id === drag.id ? { ...c, x: smoothX, y: smoothY } : c
                                    ),
                                    dragTarget: drag, // 不更新ox/oy，避免基准偏移
                                };
                            }
                        }
                        return next;
                    });
                } 
                // 处理视口平移
                else if (stateRef.current.isPanning) {
                    setState(prev => {
                        if (!prev.lastMouse) return prev;
                        return {
                            ...prev,
                            view: {
                                ...prev.view,
                                x: prev.view.x + (touch.clientX - prev.lastMouse.x),
                                y: prev.view.y + (touch.clientY - prev.lastMouse.y),
                            },
                            lastMouse: { x: touch.clientX, y: touch.clientY }
                        };
                    });
                }
            }
        };
        // ========== 修正后的onTouchEnd事件 start ==========
        const onTouchEnd = (e: TouchEvent) => {
            const touchState = touchStateRef.current;

            // 触摸拖拽结束，执行最终缓动吸附动画
            const currentState = stateRef.current;
            const dragTarget = currentState.dragTarget;
            const enableSnap = currentState.enableSnapToGrid;
            if (dragTarget && enableSnap) {
                // 处理节点/节点组
                if (dragTarget.kind === "node" || dragTarget.kind === "nodeGroup") {
                    let targetNodes = [...currentState.nodes];
                    if (dragTarget.kind === "node") {
                        targetNodes = targetNodes.map(node => {
                            if (node.id === dragTarget.id) {
                                return {
                                    ...node,
                                    x: snapToGrid(node.x, enableSnap),
                                    y: snapToGrid(node.y, enableSnap),
                                };
                            }
                            return node;
                        });
                    } else if (dragTarget.kind === "nodeGroup") {
                        targetNodes = targetNodes.map(node => {
                            if (dragTarget.ids.includes(node.id)) {
                                return {
                                    ...node,
                                    x: snapToGrid(node.x, enableSnap),
                                    y: snapToGrid(node.y, enableSnap),
                                };
                            }
                            return node;
                        });
                    }
                    animateNodeToSnapPosition(
                        currentState.nodes,
                        targetNodes,
                        enableSnap,
                        (updatedNodes) => setState(prev => ({ ...prev, nodes: updatedNodes })),
                        () => {
                            setState(prev => ({
                                ...prev,
                                isPanning: false,
                                lastMouse: undefined,
                                dragTarget: null,
                                resizing: null,
                            }));
                        }
                    );
                }
                // 处理注释框
                else if (dragTarget.kind === "comment") {
                    const comment = currentState.comments.find(c => c.id === dragTarget.id);
                    if (comment) {
                        const startTime = performance.now();
                        const animationDuration = 150;
                        const startX = comment.x;
                        const startY = comment.y;
                        const endX = snapToGrid(comment.x, enableSnap);
                        const endY = snapToGrid(comment.y, enableSnap);

                        const animateComment = (currentTime: number) => {
                            const elapsed = currentTime - startTime;
                            const progress = Math.min(elapsed / animationDuration, 1);
                            const easeProgress = 1 - Math.pow(1 - progress, 3);
                            const currentX = startX + (endX - startX) * easeProgress;
                            const currentY = startY + (endY - startY) * easeProgress;

                            setState(prev => ({
                                ...prev,
                                comments: prev.comments.map(c => 
                                    c.id === dragTarget.id ? { ...c, x: currentX, y: currentY } : c
                                )
                            }));

                            if (progress < 1) {
                                animationFrameRef.current = requestAnimationFrame(animateComment);
                            } else {
                                animationFrameRef.current = null;
                                setState(prev => ({
                                    ...prev,
                                    isPanning: false,
                                    lastMouse: undefined,
                                    dragTarget: null,
                                    resizing: null,
                                }));
                            }
                        };
                        animationFrameRef.current = requestAnimationFrame(animateComment);
                    }
                }
            } else {
                setState((prev) => ({
                    ...prev,
                    isPanning: false,
                    lastMouse: undefined,
                    dragTarget: null,
                    resizing: null,
                }));
            }
            
            // 重置触摸状态
            touchState.isTouching = false;
            touchState.isPinching = false;
            touchState.initialTouches = [];
            // 延迟重置触摸标记，避免后续触发的鼠标事件重复执行
            setTimeout(() => {
                touchState.isTouchHandled = false;
            }, 100);
        };
        // ========== 修正后的onTouchEnd事件 end ==========
        const onTouchCancel = () => {
            onTouchEnd(new TouchEvent('touchcancel'));
        };

        // 绑定触摸事件，passive: false 允许调用preventDefault
        viewport.addEventListener('touchstart', onTouchStart, { passive: false });
        viewport.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', onTouchEnd);
        window.addEventListener('touchcancel', onTouchCancel);

        return () => {
            viewport.removeEventListener('touchstart', onTouchStart);
            viewport.removeEventListener('touchmove', onTouchMove);
            window.removeEventListener('touchend', onTouchEnd);
            window.removeEventListener('touchcancel', onTouchCancel);
        };
    }, []);

    const beginDrag = (e: React.MouseEvent, target: DragTarget) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        
        if (target.kind === "node") {
            const isAlreadySelected = selectedNodeIds.includes(target.id);
            const nextSelected = isAlreadySelected ? selectedNodeIds : [target.id];
            setSelectedNodeIds(nextSelected);
            if (nextSelected.length > 1) {
                const positions: Record<number, { x: number; y: number }> = {};
                stateRef.current.nodes.forEach((node) => {
                    if (nextSelected.includes(node.id)) {
                        positions[node.id] = { x: node.x, y: node.y };
                    }
                });
                setState((prev) => ({
                    ...prev,
                    dragTarget: {
                        kind: "nodeGroup",
                        ids: nextSelected,
                        positions,
                        ox: e.clientX,
                        oy: e.clientY,
                    },
                }));
                return;
            } else {
                const node = stateRef.current.nodes.find(n => n.id === target.id);
                if (node) {
                    setState((prev) => ({
                        ...prev,
                        dragTarget: {
                            ...target,
                            ox: e.clientX,
                            oy: e.clientY,
                            startX: node.x,
                            startY: node.y,
                        },
                    }));
                    return;
                }
            }
        }
        if (target.kind === "comment") {
            const comment = stateRef.current.comments.find(c => c.id === target.id);
            if (comment) {
                setState((prev) => ({
                    ...prev,
                    dragTarget: {
                        ...target,
                        ox: e.clientX,
                        oy: e.clientY,
                        startX: comment.x,
                        startY: comment.y,
                    },
                }));
                return;
            }
        }
        setState((prev) => ({ ...prev, dragTarget: target }));
    };

    const beginTouchDrag = (e: React.TouchEvent, target: DragTarget) => {
        e.stopPropagation();
        e.preventDefault();
        const touch = e.touches[0];
        if (target.kind === "comment") {
            const comment = stateRef.current.comments.find(c => c.id === target.id);
            if (comment) {
                setState((prev) => ({
                    ...prev,
                    dragTarget: {
                        ...target,
                        ox: touch.clientX,
                        oy: touch.clientY,
                        startX: comment.x,
                        startY: comment.y,
                    },
                }));
                return;
            }
        }
        setState((prev) => ({ 
            ...prev, 
            dragTarget: { ...target, ox: touch.clientX, oy: touch.clientY } 
        }));
    };

    const beginResize = (e: React.MouseEvent, commentId: string) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        const current = stateRef.current;
        const c = current.comments.find((x) => x.id === commentId);
        if (!c) return;

        const resizing: Resizing = {
            id: commentId,
            ox: e.clientX,
            oy: e.clientY,
            startW: c.w,
            startH: c.h,
        };
        setState((prev) => ({ ...prev, resizing }));
    };

    const beginTouchResize = (e: React.TouchEvent, commentId: string) => {
        e.stopPropagation();
        e.preventDefault();
        const touch = e.touches[0];
        const current = stateRef.current;
        const c = current.comments.find((x) => x.id === commentId);
        if (!c) return;
        const resizing: Resizing = {
            id: commentId,
            ox: touch.clientX,
            oy: touch.clientY,
            startW: c.w,
            startH: c.h,
        };
        setState((prev) => ({ ...prev, resizing }));
    };

    const openModal = (id: number) => {
        setEditingId(id);
        const n = state.nodes.find((x) => x.id === id);
        if (n) setDraft({ cn: n.cn, en: n.en, code: n.code, color: n.color, character: n.character});
    };

    const editingNode = useMemo(() => {
        if (editingId === null) return null;
        return state.nodes.find((x) => x.id === editingId) ?? null;
    }, [editingId, state.nodes]);

    const closeModal = () => {
        setEditingId(null);
    };

    const openCommentModal = (id: string) => {
        setEditingCommentId(id);
        const c = state.comments.find((x) => x.id === id);
        setCommentDraft(c?.text ?? "");
        setCommentColorDraft(c?.color ?? "#5865f2");
    };

    const closeCommentModal = () => {
        setEditingCommentId(null);
    };

    const saveCommentModal = () => {
        if (!editingCommentId) return;
        setState((prev) => ({
            ...prev,
            comments: prev.comments.map((c) =>
                c.id === editingCommentId
                    ? { ...c, text: commentDraft, color: commentColorDraft }
                    : c
            ),
        }));
        closeCommentModal();
    };

    const deleteComment = () => {
        if (!editingCommentId) return;
        setState((prev) => ({
            ...prev,
            comments: prev.comments.filter((c) => c.id !== editingCommentId),
        }));
        closeCommentModal();
    };

    const saveModal = () => {
        if (editingId === null) return;
        setState((prev) => {
            const editingNode = prev.nodes.find((x) => x.id === editingId) ?? null;
            const nextNodes = prev.nodes.map((n) => {
                if (n.id !== editingId) return n;
                if (editingNode?.type === "condition") {
                    return { ...n, code: draft.code, color: draft.color };
                }
                return { ...n, 
                    cn: draft.cn, en: draft.en, 
                    code: draft.code, color: draft.color, 
                    character: draft.character
                };
            });
            return { ...prev, nodes: nextNodes };
        });
        closeModal();
    };

    const deleteCurrent = () => {
        if (editingId === null) return;
        setState((prev) => {
            const nextNodes = prev.nodes.filter((n) => n.id !== editingId);
            const nextEdges = prev.edges.filter(
                (e) => e.fromId !== editingId && e.toId !== editingId
            );
            return { ...prev, nodes: nextNodes, edges: nextEdges };
        });
        closeModal();
    };

    const onExport = () => {
        const gml = makeGml(state);
        const blob = new Blob([gml], { type: "text/plain" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = ensureGmlName(
            currentFileName === "新文件" ? "dialog_system.gml" : currentFileName
        );
        a.click();
    };

    const onImport = (file: File) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target?.result as string;
            const parsed = parseGmlEditorData(text);
            if (!parsed) {
                alert("此文件不含编辑器元数据！");
                return;
            }
            suppressDirtyRef.current = true;
            selectionDragRef.current = null;
            setSelectionBox(null);
            setSelectedNodeIds([]);
            setState(parsed);
            setEditingId(null);
            setDirty(false);
            const anyFile = file as any;
            const path = typeof anyFile.path === "string" ? anyFile.path : null;
            setCurrentFileName(file.name || "新文件");
            setCurrentFilePath(path);
            setCurrentFileHandle(null);
        };
        reader.readAsText(file);
    };

    const handleOpenClick = async () => {
        setFileMenuOpen(false);

        // 如果当前已修改，先提示保存
        if (isDirty) {
            const res = confirm("当前文件尚未保存，是否先保存更改？");
            if (res) {
                const saved = await handleSave();
                if (!saved) return; // 用户取消了保存或保存失败，停止打开流程
            }
        }

        const ipc = getIpcRenderer();
        if (!ipc) return;

        const filePath = await ipc.invoke("dialog:open");
        if (!filePath) return;

        const content = await ipc.invoke("editor:read-file", filePath);
        if (content) {
            const parsed = parseGmlEditorData(content);
            if (parsed) {
                suppressDirtyRef.current = true;
                selectionDragRef.current = null;
                setSelectionBox(null);
                setSelectedNodeIds([]);
                setState(parsed);
                setCurrentFilePath(filePath);
                setCurrentFileName(await ipc.invoke('editor:get-filename', filePath));
                setDirty(false);
            } else {
                alert("无法解析该文件。");
            }
        }
    };

    const handleSaveAs = useCallback(async (): Promise<boolean> => {
        const ipc = getIpcRenderer();
        if (!ipc) return false;
        const defaultName = ensureGmlName(currentFileName);
        const filePath = await ipc.invoke("dialog:save", defaultName);

        if (!filePath) return false;
        const content = makeGml(state);
        const result = await ipc.invoke("editor:save-file", filePath, content);

        if (result.success) {
            setCurrentFilePath(filePath);
            const fileName = await ipc.invoke('editor:get-filename', filePath);
            setCurrentFileName(fileName);
            setDirty(false);
            return true;
        } else {
            alert("保存失败（错误代码：A002）");
            return false;
        }
    }, [currentFileName, state]);

    const handleSave = useCallback(async (): Promise<boolean> => {
        const ipc = getIpcRenderer();
        if (!ipc) return false;
        const content = makeGml(state);
        // 如果已有文件路径，尝试静默保存
        if (currentFilePath) {
            const result = await ipc.invoke("editor:save-file", currentFilePath, content);
            if (result.success) {
                setDirty(false);
                return true;
            } else {
                // 静默保存失败，回退到另存为
                console.warn("Silent save failed, falling back to Save As.");
                return await handleSaveAs();
            }
        } else {
            return await handleSaveAs();
        }
    }, [currentFilePath, handleSaveAs, state]);

    useEffect(() => {
        const handleSaveShortcut = async (e: KeyboardEvent) => {
            // 匹配保存快捷键，兼容多系统
            const isSaveTrigger = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's';
            if (!isSaveTrigger) return;
    
            // 阻止浏览器默认的「保存网页」行为
            e.preventDefault();
            e.stopPropagation();
    
            // 执行保存逻辑
            await handleSave();
        };
    
        window.addEventListener('keydown', handleSaveShortcut);
        // 组件卸载时移除事件监听，避免内存泄漏
        return () => {
            window.removeEventListener('keydown', handleSaveShortcut);
        };
    }, [handleSave]);

    // 修复设置按钮和切换深/浅色模式按钮导致文件修改
    function handleThemeChange(newTheme: "dark" | "light") {
        suppressDirtyRef.current = true;
        setTheme(newTheme);
        localStorage.setItem("dialogueEditor.theme", newTheme);
        suppressDirtyRef.current = false;
    }

    function handleSettingsChange(newSettings: string) {
        suppressDirtyRef.current = true;
        setSettingsJsonText(newSettings);
        suppressDirtyRef.current = false;
    }

    // 修复另存为按钮状态问题
    useEffect(() => {
        const saveAsButton = document.getElementById("saveAsButton") as HTMLButtonElement | null;
        if (saveAsButton) {
            saveAsButton.disabled = !isDirty && !currentFilePath;
        }
        return undefined; // 确保返回 void 类型
    }, [isDirty, currentFilePath]);

    const viewportTransformStyle = useMemo(
        () =>
            ({
                transform: `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.zoom})`,
            }) satisfies React.CSSProperties,
        [state.view.x, state.view.y, state.view.zoom]
    );

    // 获取当前排序节点的连出default连线
    const sortingEdgeList = useMemo(() => {
        if (sortingEdgeNodeId === null) return [];
        return state.edges.filter(e => e.fromId === sortingEdgeNodeId && e.type === "default");
    }, [sortingEdgeNodeId, state.edges]);

    // 获取连线对应的目标节点信息
    const getTargetNode = (toId: number) => {
        return state.nodes.find(n => n.id === toId);
    };

    // 拖拽排序：交换两个连线的位置
    const handleSwapEdge = (dragIndex: number, dropIndex: number) => {
        if (dragIndex === dropIndex) return;
        setState(prev => {
            // 拆分原有edges：当前节点的default连线 + 其他所有连线
            const currentNodeEdges = prev.edges.filter(e => e.fromId === sortingEdgeNodeId && e.type === "default");
            const otherEdges = prev.edges.filter(e => !(e.fromId === sortingEdgeNodeId && e.type === "default"));
            
            // 交换位置
            const newEdges = [...currentNodeEdges];
            const [removed] = newEdges.splice(dragIndex, 1);
            newEdges.splice(dropIndex, 0, removed);
            
            // 合并回edges
            return {
                ...prev,
                edges: [...otherEdges, ...newEdges]
            };
        });
    };

    // 关闭排序弹窗
    const closeSortModal = () => {
        setSortingEdgeNodeId(null);
    };

    return (
        <>
            <TopBar
                theme={theme}
                setState={setState}
                windowSize={windowSize}
                fileMenuOpen={fileMenuOpen}
                setFileMenuOpen={setFileMenuOpen}
                handleOpenClick={handleOpenClick}
                handleSave={handleSave}
                handleSaveAs={handleSaveAs}
                fileMenuRef={fileMenuRef}
                isNewEmpty={isNewEmpty}
                fileInputRef={fileInputRef}
                onImport={onImport}
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
                                theme={theme}
                                c={c}
                                openCommentModal={openCommentModal}
                                beginDrag={beginDrag}
                                beginTouchDrag={beginTouchDrag}
                                beginResize={beginResize}
                                beginTouchResize={beginTouchResize}
                            />
                        )}

                        {state.nodes.map((n) => {
                            const isConnecting = connectingFromId === n.id;
                            const isSelected = selectedNodeIds.length > 1 && selectedNodeIds.includes(n.id);
                            
                            return (
                                <DraggableNode
                                    key={n.id}
                                    n={n}
                                    isSelected={isSelected}
                                    isConnecting={isConnecting}
                                    theme={theme}
                                    state={state}
                                    beginDrag={beginDrag}
                                    beginTouchDrag={beginTouchDrag}
                                    openModal={openModal}
                                    setState={setState}
                                    setEdgeMenu={setEdgeMenu}
                                    setSortingEdgeNodeId={setSortingEdgeNodeId}
                                />
                            );
                        })}
                    </div>
                </div>
                {selectionBox ? (
                    <div
                        style={{
                            position: "fixed",
                            left: Math.min(selectionBox.x1, selectionBox.x2),
                            top: Math.min(selectionBox.y1, selectionBox.y2),
                            width: Math.abs(selectionBox.x2 - selectionBox.x1),
                            height: Math.abs(selectionBox.y2 - selectionBox.y1),
                            border: "1px solid var(--accent)",
                            background: theme === "dark" ? "rgba(114, 137, 218, 0.16)" : "rgba(114, 137, 218, 0.12)",
                            boxShadow: "0 0 0 1px rgba(0,0,0,0.06)",
                            zIndex: 2500,
                            pointerEvents: "none",
                        }}
                    />
                ) : null}
            </div>

            {viewMode === "text" ? (
                <TextViewPanel
                    theme={theme}
                    state={state}
                    selectedNodeIds={selectedNodeIds}
                    setState={setState}
                    onFocusGraphNode={(id) => {
                        setViewMode("graph");
                        setTick(t => t + 1);
                        setSelectedNodeIds([id]);
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

            {viewMode === "graph" && edgeMenu ? (
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
                    {state.edges.filter(
                        (ed) => ed.fromId === edgeMenu.fromId && ed.type === "default"
                    ).length === 0 ? (
                        <div style={{ fontSize: 12, opacity: 0.75, padding: "6px 8px" }}>
                            暂无连线
                        </div>
                    ) : (
                        state.edges
                            .filter((ed) => ed.fromId === edgeMenu.fromId && ed.type === "default")
                            .map((ed, idx) => (
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
                    {state.edges.filter(
                        (ed) => ed.fromId === edgeMenu.fromId && ed.type === "default"
                    ).length >= 2 && (
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
                    {state.edges.some(
                        (ed) => ed.fromId === edgeMenu.fromId && ed.type === "default"
                    ) ? (
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
            ) : null}

            {/* 缩略图 */}
            {viewMode === "graph" ? (
                <MiniMap
                    zoomPercent={zoomPercent}
                    minimapSize={minimapSize}
                    minimapCanvasRef={minimapCanvasRef}
                    minimapMeta={minimapMeta}
                    minimapResizeRef={minimapResizeRef}
                    minimapViewStyle={minimapViewStyle}
                    setState={setState}
                />
            ) : null}

            {/* 节点编辑界面 */}
            {editingCommentId !== null && 
                <EditingCommentWindows
                    commentDraft={commentDraft}
                    setCommentDraft={setCommentDraft}
                    commentColorDraft={commentColorDraft}
                    setCommentColorDraft={setCommentColorDraft}
                    deleteComment={deleteComment}
                    closeCommentModal={closeCommentModal}
                    saveCommentModal={saveCommentModal}
                />
            }

            {editingId !== null && 
                <EditingNodeWindows
                    theme={theme}
                    editingNode={editingNode}
                    draft={draft}
                    setDraft={setDraft}
                    codeProfile={codeProfile}
                    deleteCurrent={deleteCurrent}
                    closeModal={closeModal}
                    saveModal={saveModal}
                />
            }

            {/* 连线排序弹窗 */}
            {sortingEdgeNodeId !== null && (
                <SortableEdgeReorderModal
                    open={sortingEdgeNodeId !== null}
                    title={`节点 #${sortingEdgeNodeId} 连线排序`}
                    subtitle="拖动行上下调整顺序，顺序决定代码生成时的选择枝索引"
                    items={sortingEdgeList}
                    onClose={closeSortModal}
                    onCommit={(nextItems) => {
                        if (sortingEdgeNodeId === null) return;

                        setState((prev) => ({
                            ...prev,
                            edges: reorderEdgesByDefaultBranch(
                                prev.edges,
                                sortingEdgeNodeId,
                                nextItems
                            ),
                        }));
                    }}
                    getItemKey={(edge, index) =>
                        `${edge.fromId}-${edge.toId}-${edge.type ?? "default"}-${index}`
                    }
                    getItemLabel={(edge) => {
                        const targetNode = getTargetNode(edge.toId);
                        return `节点 #${targetNode?.id ?? "未知"}`;
                    }}
                    getItemSubLabel={(edge) => {
                        const targetNode = getTargetNode(edge.toId);
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
                <div id="config-back">
                    <div
                        id="config-overlay"
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            width: "850px",
                            height: "600px",
                            padding: 0,
                            overflow: "hidden",
                            borderRadius: "8px"
                        }}
                    >
                        {/* --- 左侧垂直标签栏 --- */}
                        <ConfigSidebar
                            theme={theme}
                            settingsTab={settingsTab}
                            draftProfile={draftProfile}
                            state={state}
                            draftProjectState={draftProjectState}
                            setSettingsTab={setSettingsTab}
                            setCodeProfile={setCodeProfile}
                            setState={setState}
                            setSettingsOpen={setSettingsOpen}
                            setDirty={setDirty}
                        />

                        {/* 右侧内容区域 */}
                        <div className="settings-content custom-scroll">
                            {/* 1. 项目信息标签 */}
                            {settingsTab === 'info' && (
                                <ProjectInfoScreen
                                    theme={theme}
                                    codeProfile={codeProfile}
                                    draftProjectState={draftProjectState}
                                    setDraftProjectState={setDraftProjectState}
                                />
                            )}

                            {settingsTab === 'var' && (
                                <VariablesConfigScreen
                                    theme={theme}
                                    draftProjectState={draftProjectState}
                                    setDraftProjectState={setDraftProjectState}
                                />
                            )}

                            {/* 角色定义 */}
                            {settingsTab === "character" && (
                                <CharacterScreen
                                    theme={theme}
                                    draftProfile={draftProfile}
                                    setDraftProfile={setDraftProfile}
                                />
                            )}

                            {/* 代码编辑器 */}
                            {settingsTab === 'editor' && (
                                <CodeConfigScreen
                                    theme={theme}
                                    fileInputRef={fileInputRef}
                                    draftProfile={draftProfile}
                                    handleImport={handleImport}
                                    handleExport={handleExport}
                                    setCodeProfile={setCodeProfile}
                                    setDraftProfile={setDraftProfile}
                                />
                            )}

                            {/* 关于 */}
                            {settingsTab === 'about' && (
                                <AboutScreen theme={theme} />
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

declare global {
    interface Window {
        electronAPI: {
            saveFile: (filePath: string, content: string) => Promise<{ success: boolean }>;
            readFile: (filePath: string) => Promise<string>;
        };
    }
}