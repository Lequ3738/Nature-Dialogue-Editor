import { useLayoutEffect, type MutableRefObject } from "react";
import type { EditorState, ViewMode } from "../editorTypes";
import { getNodeAnchor } from "../utils/geometry";
import { getNodeBounds } from "../utils/nodeBounds";

type UseEdgeCanvasParams = {
    lineCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
    state: EditorState;
    windowSize: { w: number; h: number };
    tick: number;
    viewMode: ViewMode;
};

/**
 * 主视口连线绘制：把节点间连线以贝塞尔曲线画到 line-canvas 上，
 * 并绘制飞镖形箭头。仅在 graph 视图下工作。
 */
export function useEdgeCanvas({
    lineCanvasRef,
    state,
    windowSize,
    tick,
    viewMode,
}: UseEdgeCanvasParams) {
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
    }, [state.edges, state.nodes, state.view, windowSize, tick, viewMode]);
}
