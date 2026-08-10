import type { Node } from "../editorTypes";

/**
 * 读取节点在屏幕上的真实宽高（来自 DOM 布局）。
 * 节点以中心坐标存储，宽高供连线锚点与缩略图绘制使用。
 */
export function getNodeBounds(n: Node): { x: number; y: number; w: number; h: number } {
    const el = document.getElementById(`node-${n.id}`);
    return {
        x: n.x,
        y: n.y,
        w: el ? el.offsetWidth : 260, // 降级处理，默认260
        h: el ? el.offsetHeight : 120 // 降级处理，默认120
    };
}
