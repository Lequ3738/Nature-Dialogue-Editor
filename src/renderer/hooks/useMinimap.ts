import { useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from "react";
import type { CommentBox, Edge, EditorState, Node, ViewMode } from "../editorTypes";
import { GRID_SIZE, hasEdge } from "../editorLogic";
import type { MiniMapMeta, MiniMapResize, MiniMapSize, MiniMapViewStyle } from "../components/MiniMap";
import { getNodeAnchor } from "../utils/geometry";
import { getNodeBounds } from "../utils/nodeBounds";

type UseMinimapParams = {
    minimapCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
    state: EditorState;
    theme: "dark" | "light";
    viewMode: ViewMode;
    windowSize: { w: number; h: number };
    tick: number;
    /** 当前正在连线的节点 id（用于缩略图中高亮） */
    connectingFromId: number | null;
};

/**
 * 缩略图子系统：尺寸状态、边框拖拽缩放、坐标映射（minimapMeta）、
 * 以及把工作区缩略绘制到 minimap-canvas 上的副作用。
 */
export function useMinimap({
    minimapCanvasRef,
    state,
    theme,
    viewMode,
    windowSize,
    tick,
    connectingFromId,
}: UseMinimapParams) {
    const [minimapSize, setMinimapSize] = useState<MiniMapSize>(() => ({ w: 260, h: 180 }));
    const minimapResizeRef = useRef<null | MiniMapResize>(null);

    // 缩略图尺寸的拖拽调整
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
        // 仅节点视图下初始化缩略图画布，避免非激活状态下尺寸错误
        if (minimapCanvasRef.current && viewMode === "graph") {
            const dpr = window.devicePixelRatio || 1;
            minimapCanvasRef.current.width = minimapSize.w * dpr;
            minimapCanvasRef.current.height = minimapSize.h * dpr;
        }
    }, [minimapSize.h, minimapSize.w, viewMode, windowSize, tick]);

    // 世界坐标 → 缩略图坐标的映射参数
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
            }) satisfies CSSProperties,
        [
            minimapMeta.viewRect.height,
            minimapMeta.viewRect.left,
            minimapMeta.viewRect.top,
            minimapMeta.viewRect.width,
        ]
    );

    // 绘制缩略图：工作区内容的缩放快照
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

            // 绘制商业级"飞镖"箭头
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

    return { minimapSize, setMinimapSize, minimapResizeRef, minimapMeta, minimapViewStyle };
}
