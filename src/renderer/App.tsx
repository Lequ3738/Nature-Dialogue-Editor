import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Character, CommentBox, ConfigTabs, CustomVariable, DragTarget, Edge, EditorState, Node, ProjectData, Resizing } from "./editorTypes";
import { characterNone, createInitialState, defaultProfile } from "./editorTypes";
import { addObject, hasEdge, makeGml, parseGmlEditorData, startConnect } from "./editorLogic";
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

function hexToRgba(hex: string, alpha: number): string {
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

function getNodeAnchor(
    from: { x: number; y: number; w: number; h: number },
    to: { x: number; y: number; w: number; h: number },
    isSource: boolean
): { x: number; y: number; nx: number; ny: number } {
    const centerFrom = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
    const centerTo = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
    const dx = centerTo.x - centerFrom.x;
    const dy = centerTo.y - centerFrom.y;

    const horizontal = Math.abs(dx) > Math.abs(dy);

    if (isSource) {
        if (horizontal) {
            // 从右侧出 (nx: 1), 否则从左侧出 (nx: -1)
            return dx >= 0
                ? { x: from.x + from.w, y: centerFrom.y, nx: 1, ny: 0 }
                : { x: from.x, y: centerFrom.y, nx: -1, ny: 0 };
        }
        // 从底部出 (ny: 1), 否则从顶部出 (ny: -1)
        return dy >= 0
            ? { x: centerFrom.x, y: from.y + from.h, nx: 0, ny: 1 }
            : { x: centerFrom.x, y: from.y, nx: 0, ny: -1 };
    }

    // 对于目标节点 (Destination)，法线方向应该向外
    if (horizontal) {
        return dx >= 0
            ? { x: to.x, y: centerTo.y, nx: -1, ny: 0 }
            : { x: to.x + to.w, y: centerTo.y, nx: 1, ny: 0 };
    }
    return dy >= 0
        ? { x: centerTo.x, y: to.y, nx: 0, ny: -1 }
        : { x: centerTo.x, y: to.y + to.h, nx: 0, ny: 1 };
}

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
    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    const [editingId, setEditingId] = useState<number | null>(null);
    const [draft, setDraft] = useState<ModalDraft>({ cn: "", en: "", code: "", color: "#7289da", character: characterNone });
    const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
    const [commentDraft, setCommentDraft] = useState<string>("");
    const [commentColorDraft, setCommentColorDraft] = useState<string>("#5865f2");

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

        console.log("Loaded code profile:", profile);
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

    // 窗口缩放监听
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const handleResize = () => setTick(t => t + 1);
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

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
        if (lineCanvasRef.current) {
            lineCanvasRef.current.width = window.innerWidth;
            lineCanvasRef.current.height = window.innerHeight;
        }
        if (minimapCanvasRef.current) {
            const dpr = window.devicePixelRatio || 1;
            minimapCanvasRef.current.width = minimapSize.w * dpr;
            minimapCanvasRef.current.height = minimapSize.h * dpr;
        }
    }, [minimapSize.h, minimapSize.w]);

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

                minX = Math.min(minX, n.x);
                minY = Math.min(minY, n.y);
                maxX = Math.max(maxX, n.x + w);
                maxY = Math.max(maxY, n.y + h);
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
        const offsetX = pad - minX * scale;
        const offsetY = pad - minY * scale;

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
        minimapSize.h,
        minimapSize.w,
        state.nodes,
        state.comments,
        state.view.x,
        state.view.y,
        state.view.zoom,
        windowSize.w,
        windowSize.h,
        tick
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
        const canvas = lineCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;

        // 直接获取画布当前的布局尺寸
        const rect = canvas.getBoundingClientRect();
        const logicalWidth = rect.width;
        const logicalHeight = rect.height;

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
            else ctx.strokeStyle = "#7289da";

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
    }, [state.edges, state.nodes, state.view, windowSize, tick]);

    // Draw minimap: render a scaled snapshot of the current workspace.
    useEffect(() => {
        const canvas = minimapCanvasRef.current;
        if (!canvas) return;
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
        const worldGrid = 40;
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

        const drawNode = (n: Node, isConnecting: boolean) => {
            const bounds = getNodeBounds(n); // 获取真实尺寸
            const { x, y } = worldToMini(n.x, n.y);
            const w = bounds.w * scale;
            const h = bounds.h * scale;
            const r = 10 * scale;
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

            // Header stripe
            ctx.fillStyle = theme === "light" ? "rgba(59,130,246,0.06)" : "rgba(255,255,255,0.06)";
            ctx.fillRect(x, y, w, headerH);

            // Footer stripe
            ctx.fillStyle = theme === "light" ? "rgba(59,130,246,0.05)" : "rgba(255,255,255,0.04)";
            ctx.fillRect(x, y + h - footerH, w, footerH);

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
                edge.type === "true" ? "#43b581" : edge.type === "false" ? "#f04747" : "#7289da";
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
    }, [state.nodes, state.comments, state.edges, minimapMeta, theme, connectingFromId, tick]);

    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;

        const onMouseDown = (e: MouseEvent) => {
            if (touchStateRef.current.isTouchHandled) return;

            // Middle mouse button panning.
            if (e.button === 1) {
                e.preventDefault();
                setState((prev) => ({
                    ...prev,
                    isPanning: true,
                    lastMouse: { x: e.clientX, y: e.clientY },
                }));
            }
        };

        const onMouseMove = (e: MouseEvent) => {
            if (touchStateRef.current.isTouchHandled) return;

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

                    if (drag.kind === "node") {
                        next = {
                            ...next,
                            nodes: next.nodes.map((n) =>
                                n.id === drag.id ? { ...n, x: n.x + dx, y: n.y + dy } : n
                            ),
                            dragTarget: { ...drag, ox: e.clientX, oy: e.clientY },
                        };
                    } else {
                        next = {
                            ...next,
                            comments: next.comments.map((c) =>
                                c.id === drag.id ? { ...c, x: c.x + dx, y: c.y + dy } : c
                            ),
                            dragTarget: { ...drag, ox: e.clientX, oy: e.clientY },
                        };
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

        const onMouseUp = () => {
            if (touchStateRef.current.isTouchHandled) return;

            setState((prev) => ({
                ...prev,
                isPanning: false,
                lastMouse: undefined,
                dragTarget: null,
                resizing: null,
            }));
        };

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
            if (touches.length === 1 && stateRef.current.isPanning) {
                e.preventDefault();
                const touch = touches[0];
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
        };

        // 触摸结束/取消
        const onTouchEnd = (e: TouchEvent) => {
            const touchState = touchStateRef.current;
            
            // 重置触摸状态
            touchState.isTouching = false;
            touchState.isPinching = false;
            touchState.initialTouches = [];

            // 重置编辑器状态
            setState(prev => ({
                ...prev,
                isPanning: false,
                lastMouse: undefined,
                dragTarget: null,
                resizing: null
            }));

            // 延迟重置触摸标记，避免后续触发的鼠标事件重复执行
            setTimeout(() => {
                touchState.isTouchHandled = false;
            }, 100);
        };

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
        // Only left button drags objects. Middle button reserved for viewport panning.
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        setState((prev) => ({ ...prev, dragTarget: target }));
    };

    const beginTouchDrag = (e: React.TouchEvent, target: DragTarget) => {
        e.stopPropagation();
        e.preventDefault();
        const touch = e.touches[0];
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
                setState(parsed);
                setCurrentFilePath(filePath);
                setCurrentFileName(await ipc.invoke('editor:get-filename', filePath));
                setDirty(false);
            } else {
                alert("无法解析该文件。");
            }
        }
    };

    const handleSave = async (): Promise<boolean> => {
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
                // 静默保存失败（如 A001 情况），回退到另存为
                console.warn("Silent save failed, falling back to Save As.");
                return await handleSaveAs();
            }
        } else {
            return await handleSaveAs();
        }
    };

    const handleSaveAs = async (): Promise<boolean> => {
        const ipc = getIpcRenderer();
        if (!ipc) return false;

        const defaultName = ensureGmlName(currentFileName);
        const filePath = await ipc.invoke("dialog:save", defaultName);

        if (!filePath) return false;

        const result = await ipc.invoke("editor:save-file", filePath, makeGml(state));
        if (result.success) {
            setCurrentFilePath(filePath);
            setCurrentFileName(await ipc.invoke('editor:get-filename', filePath)); // 更新标题为选择的文件名
            setDirty(false);
            return true;
        } else {
            alert("保存失败（错误代码：A002）");
            return false;
        }
    };

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
            />

            <div id="viewport" ref={viewportRef}>
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
                        {state.comments.map((c) => (
                            <div
                                key={c.id}
                                className="comment-box"
                                style={{
                                    left: c.x,
                                    top: c.y,
                                    width: c.w,
                                    height: c.h,
                                    borderColor: c.color,
                                    background: hexToRgba(c.color, theme === "light" ? 0.08 : 0.06),
                                }}
                            >
                                <div
                                    className="comment-handle"
                                    style={{
                                        background: c.color,
                                        borderColor: c.color,
                                        color: "#fff",
                                    }}
                                    onDoubleClick={(e) => {
                                        e.stopPropagation();
                                        openCommentModal(c.id);
                                    }}
                                    onMouseDown={(e) =>
                                        beginDrag(e, {
                                            kind: "comment",
                                            id: c.id,
                                            ox: e.clientX,
                                            oy: e.clientY,
                                        })
                                    }
                                    onTouchStart={(e) =>
                                        beginTouchDrag(e, {
                                            kind: "comment",
                                            id: c.id,
                                            ox: e.touches[0].clientX,
                                            oy: e.touches[0].clientY,
                                        })
                                    }
                                >
                                    {c.text}
                                </div>
                                <div
                                    className="comment-resizer"
                                    onMouseDown={(e) => beginResize(e, c.id)}
                                    onTouchStart={(e) => beginTouchResize(e, c.id)}
                                />
                            </div>
                        ))}

                        {state.nodes.map((n) => {
                            const isCond = n.type === "condition";
                            const isStart = n.type === "start";
                            const isConnecting = connectingFromId === n.id;
                            return (
                                <div
                                    key={n.id}
                                    id={`node-${n.id}`}
                                    className={`node ${isStart ? "start-node" : ""}`}
                                    style={{
                                        left: n.x,
                                        top: n.y,
                                        borderColor: n.color,
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
                                        <span style={{ textAlign: "center" }}> {
                                            isStart ?
                                                "开始" :
                                                (isCond ? "条件" : 
                                                    (n.type === "end" ? "结束" : 
                                                        `对话：${n.character.name}`
                                                    )
                                                )
                                        }
                                        </span>
                                        {
                                            !isStart ?
                                                (
                                                    <span
                                                        style={{ cursor: "pointer" }}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            openModal(n.id);
                                                        }}
                                                    >
                                                        ⚙️
                                                    </span>
                                                ) : null
                                        }
                                    </div>

                                    {
                                        !isStart ?
                                            (
                                                <div className="node-body has-tooltip"
                                                    title={ n.type === "node" && n.code ? `执行代码：\n\n${n.code}` : undefined }
                                                >
                                                    {
                                                        isCond ? (
                                                            n.code ? n.code :
                                                                <><span style={{ color: "#888" }}>请添加有效的表达式。</span></>
                                                        ) : (
                                                            n.type === "end" ? (
                                                                n.code ? n.code :
                                                                    <><span style={{ color: "#888" }}>请添加有效的代码语句。</span></>
                                                            ) :
                                                                <>
                                                                    <span style={{ color: "#888" }}>中文：</span> {
                                                                        n.cn ? n.cn :
                                                                            <><span style={{ color: "#888" }}>无内容。</span></>
                                                                    }
                                                                    <hr style={{ opacity: 0.2 }} />
                                                                    <span style={{ color: "#888" }}>英文：</span> {
                                                                        n.en ? n.en :
                                                                            <><span style={{ color: "#888" }}>无内容。</span></>
                                                                    }
                                                                </>
                                                        )
                                                    }
                                                </div>
                                            ) : null
                                    }

                                    <div className={`node-footer ${isStart ? "start-node-footer" : ""}`}>
                                        {
                                            isCond ? (
                                                <>
                                                    <button
                                                        className={`port 
                                                    ${hasEdge(state, n.id, "true") ? "connected" : ""}
                                                `}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setState((prev) =>
                                                                startConnect(prev, n.id, "true")
                                                            );
                                                        }}
                                                        onContextMenu={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            setState((prev) => ({
                                                                ...prev,
                                                                edges: prev.edges.filter(
                                                                    (ed) =>
                                                                        !(
                                                                            ed.fromId === n.id &&
                                                                            ed.type === "true"
                                                                        )
                                                                ),
                                                            }));
                                                        }}
                                                        title="右键删除 TRUE 连线"
                                                    >
                                                        TRUE
                                                    </button>
                                                    <button
                                                        className={
                                                            `port ${hasEdge(state, n.id, "false") ? "connected" : ""}
                                                    FALSE
                                                `}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setState((prev) =>
                                                                startConnect(prev, n.id, "false")
                                                            );
                                                        }}
                                                        onContextMenu={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            setState((prev) => ({
                                                                ...prev,
                                                                edges: prev.edges.filter(
                                                                    (ed) =>
                                                                        !(
                                                                            ed.fromId === n.id &&
                                                                            ed.type === "false"
                                                                        )
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
                                                    <button
                                                        className={`port ${hasEdge(state, n.id, "default") ? "connected" : ""}`}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setState((prev) =>
                                                                startConnect(prev, n.id, "default")
                                                            );
                                                        }}
                                                        onContextMenu={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            if (n.type === "start") {
                                                                setState((prev) => ({
                                                                    ...prev,
                                                                    edges: prev.edges.filter(
                                                                        (ed) =>
                                                                            !(
                                                                                ed.fromId === n.id &&
                                                                                ed.type === "default"
                                                                            )
                                                                    ),
                                                                }));
                                                            } else {
                                                                // 普通节点允许多条连线：弹出菜单让用户自由选择删哪条
                                                                setEdgeMenu({
                                                                    fromId: n.id,
                                                                    x: e.clientX,
                                                                    y: e.clientY,
                                                                });
                                                            }
                                                        }}
                                                        title={n.type === "end" ? "" : "右键删除 NEXT 连线"}
                                                    >
                                                        {n.type === "end" ? "结束" : "NEXT →"}
                                                    </button>
                                                    {
                                                        isStart ? (
                                                            <span
                                                                style={{ cursor: "pointer" }}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    openModal(n.id);
                                                                }}
                                                            >
                                                                ⚙️
                                                            </span>
                                                        ) : null
                                                    }
                                                </>
                                            )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {edgeMenu ? (
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
            <MiniMap
                zoomPercent={zoomPercent}
                minimapSize={minimapSize}
                minimapCanvasRef={minimapCanvasRef}
                minimapMeta={minimapMeta}
                minimapResizeRef={minimapResizeRef}
                minimapViewStyle={minimapViewStyle}
                setState={setState}
            />

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
