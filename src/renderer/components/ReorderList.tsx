import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
export type SortableEdgeLike = {
    fromId: number;
    toId: number;
    type?: string;
};
export type SortableEdgeReorderModalProps<T extends SortableEdgeLike> = {
    open: boolean;
    title: string;
    subtitle?: string;
    items: T[];
    onClose: () => void;
    onCommit: (nextItems: T[]) => void;
    getItemLabel?: (item: T, index: number) => React.ReactNode;
    getItemSubLabel?: (item: T, index: number) => React.ReactNode;
    getItemKey?: (item: T, index: number) => React.Key;
    accentClassName?: string;
    maxHeight?: number;
};
type DragState = {
    active: boolean;
    pointerId: number | null;
    fromIndex: number; // 拖拽起始索引（固定不变）
    overIndex: number; // 当前悬浮目标索引（实时更新）
    startClientY: number; // 鼠标按下时的clientY
    currentOffsetY: number; // 鼠标当前相对起始位置的Y轴偏移（含阻力）
    rawOffsetY: number; // 鼠标原始偏移（无阻力，用于计算边界）
    itemHeight: number; // 拖拽元素的高度
    containerRect: DOMRect | null; // 容器的视口矩形
};
const DEFAULT_ITEM_HEIGHT = 72;
const GAP = 8;
const ANIMATION_DURATION = 200; // 归位动画时长（ms）
const BOUNCE_DURATION = 150; // 回弹动画时长（ms）
const OVERSCROLL_RESISTANCE = 0.2; // 边界阻力系数（0-1，越小阻力越大）

function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
}
function moveItem<T>(list: T[], fromIndex: number, toIndex: number): T[] {
    if (fromIndex === toIndex) return list.slice();
    const next = list.slice();
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    return next;
}
export function SortableEdgeReorderModal<T extends SortableEdgeLike>({
    open,
    title,
    subtitle,
    items,
    onClose,
    onCommit,
    getItemLabel,
    getItemSubLabel,
    getItemKey,
    maxHeight = 400,
}: SortableEdgeReorderModalProps<T>) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    // 用item唯一key存储元素ref，保证数组顺序变化后引用不失效
    const itemRefs = useRef<Map<React.Key, HTMLDivElement | null>>(new Map());
    // 拖拽状态
    const [dragState, setDragState] = useState<DragState | null>(null);
    // 动画阶段：idle(空闲) -> dragging(拖拽中) -> bouncing(回弹中) -> settling(归位中)
    const [animationPhase, setAnimationPhase] = useState<"idle" | "dragging" | "bouncing" | "settling">("idle");
    // 基础渲染数组：拖拽过程中不修改，仅拖拽结束更新，保证动画平滑
    const [baseOrder, setBaseOrder] = useState<T[]>(items);

    // 弹窗打开/关闭时重置所有状态
    useEffect(() => {
        if (!open) return;
        setBaseOrder(items);
        setDragState(null);
        setAnimationPhase("idle");
        itemRefs.current.clear();
    }, [open, items]);

    // 提交并关闭
    const commitAndClose = useCallback(() => {
        onCommit(baseOrder);
        onClose();
    }, [onCommit, onClose, baseOrder]);

    // ESC关闭弹窗
    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, onClose]);

    // 核心1：计算鼠标当前悬浮的目标索引（修正边界逻辑）
    const calculateOverIndex = useCallback(
        (clientY: number, container: HTMLDivElement) => {
            const containerRect = container.getBoundingClientRect();
            // 鼠标在容器内的相对位置（包含滚动）
            const relativeY = clientY - containerRect.top + container.scrollTop;
            
            // 遍历所有元素，计算每个元素的上下边界
            let cumulativeTop = 0;
            for (let i = 0; i < baseOrder.length; i++) {
                const key = getItemKey
                    ? getItemKey(baseOrder[i], i)
                    : `${baseOrder[i].fromId}-${baseOrder[i].toId}-${i}`;
                const el = itemRefs.current.get(key);
                const itemHeight = el?.getBoundingClientRect().height ?? DEFAULT_ITEM_HEIGHT;
                
                // 鼠标落在当前元素的范围内，返回当前索引
                if (relativeY >= cumulativeTop && relativeY <= cumulativeTop + itemHeight + GAP) {
                    return i;
                }
                cumulativeTop += itemHeight + GAP;
            }
            // 超出范围返回边界索引
            return relativeY <= 0 ? 0 : baseOrder.length - 1;
        },
        [baseOrder, getItemKey]
    );

    // 核心2：动态计算每个元素的显示序号（实时跟随拖拽变化）
    const getDisplayIndex = useCallback((originalIndex: number) => {
        if (animationPhase === "idle") return originalIndex + 1;
        if (!dragState) return originalIndex + 1;
        const { fromIndex, overIndex } = dragState;
        
        // 情况1：拖拽元素本身，显示目标位置的序号
        if (originalIndex === fromIndex) {
            return overIndex + 1;
        }
        // 情况2：从前往后拖
        if (fromIndex < overIndex) {
            // 拖拽路径上的元素，序号减1
            if (originalIndex > fromIndex && originalIndex <= overIndex) {
                return originalIndex;
            }
        }
        // 情况3：从后往前拖
        else if (fromIndex > overIndex) {
            // 拖拽路径上的元素，序号加1
            if (originalIndex >= overIndex && originalIndex < fromIndex) {
                return originalIndex + 2;
            }
        }
        // 不在拖拽路径上的元素，序号不变
        return originalIndex + 1;
    }, [dragState, animationPhase]);

    // 核心3：计算每个元素的Y轴偏移量，实现挤开/让位动画
    const getItemTranslateY = useCallback((index: number) => {
        if (animationPhase === "idle") return 0;
        if (!dragState) return 0;
        const { fromIndex, overIndex, itemHeight } = dragState;
        const itemFullHeight = itemHeight + GAP;

        // 拖拽元素本身：原位置偏移为0，靠悬浮层展示
        if (index === fromIndex) return 0;

        // 情况1：从前往后拖（fromIndex < overIndex）
        if (fromIndex < overIndex) {
            // 拖拽路径上的元素，向上偏移让位
            if (index > fromIndex && index <= overIndex) {
                return -itemFullHeight;
            }
        }
        // 情况2：从后往前拖（fromIndex > overIndex）
        else if (fromIndex > overIndex) {
            // 拖拽路径上的元素，向下偏移让位
            if (index >= overIndex && index < fromIndex) {
                return itemFullHeight;
            }
        }

        // 不在拖拽路径上的元素，无偏移
        return 0;
    }, [dragState, animationPhase]);

    // 开始拖拽
    const beginDrag = useCallback(
        (item: T, index: number, e: React.PointerEvent<HTMLDivElement>) => {
            if (!open || animationPhase !== "idle") return;
            if (e.button !== 0) return;
            const container = containerRef.current;
            const key = getItemKey
                ? getItemKey(item, index)
                : `${item.fromId}-${item.toId}-${index}`;
            const el = itemRefs.current.get(key);
            if (!container || !el) return;

            e.preventDefault();
            e.stopPropagation();
            const containerRect = container.getBoundingClientRect();
            const itemRect = el.getBoundingClientRect();

            // 初始化拖拽状态，记录所有初始值
            const nextDrag: DragState = {
                active: true,
                pointerId: e.pointerId,
                fromIndex: index,
                overIndex: index,
                startClientY: e.clientY,
                currentOffsetY: 0,
                rawOffsetY: 0,
                itemHeight: itemRect.height,
                containerRect: containerRect,
            };
            setDragState(nextDrag);
            setAnimationPhase("dragging");

            // 捕获指针，保证鼠标移出元素也能持续跟踪
            try {
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            } catch {
                // 忽略兼容性错误
            }
        },
        [open, animationPhase, getItemKey]
    );

    // 拖拽移动：更新偏移量和目标索引（新增阻力和正确边界）
    useEffect(() => {
        if (!open || animationPhase !== "dragging") return;
        const container = containerRef.current;
        if (!container || !dragState) return;

        const onPointerMove = (e: PointerEvent) => {
            const cur = dragState;
            if (!cur || !cur.active) return;
            if (cur.pointerId !== null && e.pointerId !== cur.pointerId) return;
            e.preventDefault();

            // 1. 计算原始偏移量（无阻力）
            const rawOffsetY = e.clientY - cur.startClientY;
            // 2. 计算合法偏移范围（修正：无论从哪开始，最小到第0位，最大到最后一位）
            const itemFullHeight = cur.itemHeight + GAP;
            const minLegalOffset = -cur.fromIndex * itemFullHeight;
            const maxLegalOffset = (baseOrder.length - 1 - cur.fromIndex) * itemFullHeight;

            // 3. 计算带阻力的偏移量（核心回弹手感）
            let currentOffsetY = rawOffsetY;
            if (rawOffsetY < minLegalOffset) {
                // 超出上边界：超出部分施加阻力
                const overshoot = rawOffsetY - minLegalOffset;
                currentOffsetY = minLegalOffset + overshoot * OVERSCROLL_RESISTANCE;
            } else if (rawOffsetY > maxLegalOffset) {
                // 超出下边界：超出部分施加阻力
                const overshoot = rawOffsetY - maxLegalOffset;
                currentOffsetY = maxLegalOffset + overshoot * OVERSCROLL_RESISTANCE;
            }

            // 4. 计算当前悬浮的目标索引（仅在合法范围内更新）
            let targetIndex = cur.overIndex;
            if (rawOffsetY >= minLegalOffset && rawOffsetY <= maxLegalOffset) {
                targetIndex = calculateOverIndex(e.clientY, container);
            }

            // 5. 更新拖拽状态
            setDragState({
                ...cur,
                rawOffsetY,
                currentOffsetY,
                overIndex: targetIndex,
            });
        };

        // 拖拽结束：启动回弹/归位动画
        const onPointerUp = (e: PointerEvent) => {
            const cur = dragState;
            if (!cur || !cur.active) return;
            if (cur.pointerId !== null && e.pointerId !== cur.pointerId) return;
            e.preventDefault();

            // 释放指针捕获
            try {
                (e.target as HTMLElement).releasePointerCapture(e.pointerId);
            } catch {
                // 忽略兼容性错误
            }

            // 计算合法偏移范围
            const itemFullHeight = cur.itemHeight + GAP;
            const minLegalOffset = -cur.fromIndex * itemFullHeight;
            const maxLegalOffset = (baseOrder.length - 1 - cur.fromIndex) * itemFullHeight;

            // 判断是否需要回弹
            const needsBounce = cur.rawOffsetY < minLegalOffset || cur.rawOffsetY > maxLegalOffset;
            
            if (needsBounce) {
                // 阶段1：先回弹到合法边界
                setAnimationPhase("bouncing");
                // 计算回弹目标位置
                const bounceTargetOffset = clamp(cur.rawOffsetY, minLegalOffset, maxLegalOffset);
                setDragState(prev => prev ? { ...prev, currentOffsetY: bounceTargetOffset } : null);
                
                // 回弹结束后，进入归位阶段
                setTimeout(() => {
                    setAnimationPhase("settling");
                    // 归位结束后更新数组
                    setTimeout(() => {
                        if (cur.fromIndex !== cur.overIndex) {
                            setBaseOrder(prev => moveItem(prev, cur.fromIndex, cur.overIndex));
                        }
                        setAnimationPhase("idle");
                        setDragState(null);
                    }, ANIMATION_DURATION);
                }, BOUNCE_DURATION);
            } else {
                // 不需要回弹，直接归位
                setAnimationPhase("settling");
                setTimeout(() => {
                    if (cur.fromIndex !== cur.overIndex) {
                        setBaseOrder(prev => moveItem(prev, cur.fromIndex, cur.overIndex));
                    }
                    setAnimationPhase("idle");
                    setDragState(null);
                }, ANIMATION_DURATION);
            }
        };

        // 拖拽取消：重置状态
        const onPointerCancel = () => {
            setAnimationPhase("idle");
            setDragState(null);
            setBaseOrder(items);
        };

        window.addEventListener("pointermove", onPointerMove, { passive: false });
        window.addEventListener("pointerup", onPointerUp, { passive: false });
        window.addEventListener("pointercancel", onPointerCancel);
        return () => {
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
            window.removeEventListener("pointercancel", onPointerCancel);
        };
    }, [items, open, dragState, animationPhase, calculateOverIndex, baseOrder.length]);

    // 计算悬浮层的位置（拖拽中跟手+阻力，回弹/归位时缓动）
    const floatingLayerStyle = useMemo(() => {
        if (!dragState || animationPhase === "idle") return {};
        const { fromIndex, overIndex, currentOffsetY, itemHeight, containerRect } = dragState;
        const itemFullHeight = itemHeight + GAP;
        
        // 归位动画目标位置
        const settleTargetOffsetY = (overIndex - fromIndex) * itemFullHeight;
        
        // 根据动画阶段选择偏移量
        let finalOffsetY = currentOffsetY;
        let transition = "top 0.05s linear";
        
        if (animationPhase === "bouncing") {
            // 回弹阶段：缓动到边界
            transition = `top ${BOUNCE_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1)`;
        } else if (animationPhase === "settling") {
            // 归位阶段：缓动到目标位置
            finalOffsetY = settleTargetOffsetY;
            transition = `top ${ANIMATION_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1)`;
        }

        return {
            position: "fixed" as const,
            left: containerRect?.left ?? 0,
            top: (containerRect?.top ?? 0) + (fromIndex * itemFullHeight) + finalOffsetY,
            width: containerRect?.width ?? 500,
            pointerEvents: "none" as const,
            zIndex: 9999,
            transition,
        };
    }, [dragState, animationPhase]);

    if (!open) return null;

    return (
        <div
            id="modal-overlay"
            style={{ display: "flex" }}
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                id="modal"
                style={{
                    width: 520,
                    maxHeight: "80vh",
                    display: "flex",
                    flexDirection: "column",
                }}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <h3 style={{ margin: 0, marginBottom: 12 }}>{title}</h3>
                {subtitle ? (
                    <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 16 }}>{subtitle}</div>
                ) : null}
                {items.length === 0 ? (
                    <div style={{ textAlign: "center", padding: 24, opacity: 0.6 }}>
                        没有可排序的项目
                    </div>
                ) : (
                    <div
                        ref={containerRef}
                        style={{
                            position: "relative",
                            display: "flex",
                            flexDirection: "column",
                            gap: GAP,
                            maxHeight,
                            overflowY: "auto",
                            padding: "4px 0",
                            userSelect: "none",
                            touchAction: "none",
                        }}
                    >
                        {/* 列表渲染：基础顺序不变，通过translateY实现动画 */}
                        {baseOrder.map((item, index) => {
                            const key = getItemKey
                                ? getItemKey(item, index)
                                : `${item.fromId}-${item.toId}-${index}`;
                            const isDraggingOrAnimating = animationPhase !== "idle" && index === dragState?.fromIndex;
                            const translateY = getItemTranslateY(index);
                            const displayIndex = getDisplayIndex(index);
                            
                            return (
                                <div
                                    key={String(key)}
                                    ref={(el) => {
                                        itemRefs.current.set(key, el);
                                    }}
                                    onPointerDown={(e) => beginDrag(item, index, e)}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 12,
                                        padding: "12px 16px",
                                        background: "var(--panel)",
                                        border: "1px solid var(--panel-border)",
                                        borderRadius: 8,
                                        cursor: isDraggingOrAnimating ? "grabbing" : "grab",
                                        position: "relative",
                                        width: "100%",
                                        boxSizing: "border-box",
                                        // 拖拽/动画中的元素：原位置隐藏，保留占位高度
                                        opacity: isDraggingOrAnimating ? 0 : 1,
                                        // 核心挤开动画：平滑过渡translateY
                                        transform: `translateY(${translateY}px)`,
                                        transition: isDraggingOrAnimating
                                            ? "none"
                                            : `transform ${ANIMATION_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1), opacity 160ms ease`,
                                        zIndex: isDraggingOrAnimating ? 0 : 1,
                                        willChange: "transform",
                                    }}
                                >
                                    <span
                                        style={{
                                            fontSize: 18,
                                            fontWeight: 700,
                                            opacity: 0.5,
                                            minWidth: 30,
                                            flex: "0 0 auto",
                                        }}
                                    >
                                        {displayIndex}
                                    </span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div
                                            style={{
                                                fontWeight: 600,
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                            }}
                                        >
                                            {getItemLabel
                                                ? getItemLabel(item, index)
                                                : `目标节点 #${item.toId}`}
                                        </div>
                                        <div
                                            style={{
                                                fontSize: 12,
                                                opacity: 0.75,
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                            }}
                                        >
                                            {getItemSubLabel
                                                ? getItemSubLabel(item, index)
                                                : `from #${item.fromId}`}
                                        </div>
                                    </div>
                                    <span
                                        style={{ fontSize: 16, opacity: 0.5, flex: "0 0 auto" }}
                                    >
                                        ⋮⋮
                                    </span>
                                </div>
                            );
                        })}

                        {/* 拖拽悬浮层：完全跟随鼠标/动画，脱离文档流 */}
                        {animationPhase !== "idle" && dragState && (
                            <div style={floatingLayerStyle}>
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 12,
                                        padding: "12px 16px",
                                        background: "var(--panel)",
                                        border: "1px solid var(--accent)",
                                        borderRadius: 8,
                                        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                                        width: "100%",
                                        boxSizing: "border-box",
                                        opacity: 0.95,
                                    }}
                                >
                                    <span
                                        style={{
                                            fontSize: 18,
                                            fontWeight: 700,
                                            opacity: 0.5,
                                            minWidth: 30,
                                            flex: "0 0 auto",
                                        }}
                                    >
                                        {getDisplayIndex(dragState.fromIndex)}
                                    </span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div
                                            style={{
                                                fontWeight: 600,
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                            }}
                                        >
                                            {getItemLabel
                                                ? getItemLabel(baseOrder[dragState.fromIndex], dragState.fromIndex)
                                                : `目标节点 #${baseOrder[dragState.fromIndex].toId}`}
                                        </div>
                                        <div
                                            style={{
                                                fontSize: 12,
                                                opacity: 0.75,
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                            }}
                                        >
                                            {getItemSubLabel
                                                ? getItemSubLabel(baseOrder[dragState.fromIndex], dragState.fromIndex)
                                                : `from #${baseOrder[dragState.fromIndex].fromId}`}
                                        </div>
                                    </div>
                                    <span
                                        style={{ fontSize: 16, opacity: 0.5, flex: "0 0 auto" }}
                                    >
                                        ⋮⋮
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                <div
                    style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}
                >
                    <button onClick={onClose} className="secondary-button">
                        取消
                    </button>
                    <button onClick={commitAndClose}>确定</button>
                </div>
            </div>
        </div>
    );
}
export function reorderEdgesByDefaultBranch<T extends SortableEdgeLike>(
    edges: T[],
    sortingEdgeNodeId: number | null,
    nextOrder: T[]
): T[] {
    if (sortingEdgeNodeId === null) return edges.slice();
    const currentNodeEdges = edges.filter(
        (e) => e.fromId === sortingEdgeNodeId && e.type === "default"
    );
    const otherEdges = edges.filter(
        (e) => !(e.fromId === sortingEdgeNodeId && e.type === "default")
    );
    if (currentNodeEdges.length !== nextOrder.length) {
        return edges.slice();
    }
    return [...otherEdges, ...nextOrder];
}