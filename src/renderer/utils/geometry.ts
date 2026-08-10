/**
 * 纯几何辅助函数：屏幕/世界坐标换算、矩形求交、连线锚点、触摸手势。
 */

/** 视口变换：将客户端像素坐标换算为世界坐标 */
export function clientToWorld(
    clientX: number,
    clientY: number,
    view: { x: number; y: number; zoom: number }
): { x: number; y: number } {
    return {
        x: (clientX - view.x) / view.zoom,
        y: (clientY - view.y) / view.zoom,
    };
}

/** 将任意顺序的框选矩形规整为 left/top/right/bottom */
export function normalizeClientRect(rect: { x1: number; y1: number; x2: number; y2: number }): {
    left: number;
    top: number;
    right: number;
    bottom: number;
} {
    return {
        left: Math.min(rect.x1, rect.x2),
        top: Math.min(rect.y1, rect.y2),
        right: Math.max(rect.x1, rect.x2),
        bottom: Math.max(rect.y1, rect.y2),
    };
}

export function rectsIntersect(
    a: { left: number; top: number; right: number; bottom: number },
    b: DOMRect
): boolean {
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

/**
 * 计算节点间连线的锚点坐标与法线方向。
 * 节点 x/y 是中心坐标；返回锚点世界坐标 + 出/入口法线 (nx, ny)，用于贝塞尔控制点。
 */
export function getNodeAnchor(
    from: { x: number; y: number; w: number; h: number },
    to: { x: number; y: number; w: number; h: number },
    isSource: boolean
): { x: number; y: number; nx: number; ny: number } {
    const centerFrom = { x: from.x, y: from.y };
    const centerTo = { x: to.x, y: to.y };
    const dx = centerTo.x - centerFrom.x;
    const dy = centerTo.y - centerFrom.y;
    const horizontal = Math.abs(dx) > Math.abs(dy);

    if (isSource) {
        if (horizontal) {
            return dx >= 0
                ? { x: from.x + from.w / 2, y: centerFrom.y, nx: 1, ny: 0 }
                : { x: from.x - from.w / 2, y: centerFrom.y, nx: -1, ny: 0 };
        }
        return dy >= 0
            ? { x: centerFrom.x, y: from.y + from.h / 2, nx: 0, ny: 1 }
            : { x: centerFrom.x, y: from.y - from.h / 2, nx: 0, ny: -1 };
    }

    // 目标节点：法线方向向外（指向来源一侧）
    if (horizontal) {
        return dx >= 0
            ? { x: to.x - to.w / 2, y: centerTo.y, nx: -1, ny: 0 }
            : { x: to.x + to.w / 2, y: centerTo.y, nx: 1, ny: 0 };
    }
    return dy >= 0
        ? { x: centerTo.x, y: to.y - to.h / 2, nx: 0, ny: -1 }
        : { x: centerTo.x, y: to.y + to.h / 2, nx: 0, ny: 1 };
}

/** 两个触摸点之间的距离 */
export function getTouchDistance(touch1: Touch, touch2: Touch): number {
    return Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);
}

/** 两个触摸点的中心点 */
export function getTouchCenter(touch1: Touch, touch2: Touch): { x: number; y: number } {
    return {
        x: (touch1.clientX + touch2.clientX) / 2,
        y: (touch1.clientY + touch2.clientY) / 2,
    };
}
