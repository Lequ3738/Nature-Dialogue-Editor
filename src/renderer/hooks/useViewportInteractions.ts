import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from "react";
import type { DragTarget, EditorState, Resizing, SelectionBox, ViewMode } from "../editorTypes";
import { snapToGrid } from "../editorLogic";
import { getTouchCenter, getTouchDistance, normalizeClientRect, rectsIntersect } from "../utils/geometry";
import { snapDragTargetToGrid } from "../utils/snap";

type UseViewportInteractionsParams = {
    viewportRef: MutableRefObject<HTMLDivElement | null>;
    stateRef: MutableRefObject<EditorState>;
    /** 当前编辑器状态，用于清除失效选中项 */
    state: EditorState;
    setState: Dispatch<SetStateAction<EditorState>>;
    viewModeRef: MutableRefObject<ViewMode>;
    animationFrameRef: MutableRefObject<number | null>;
};

export type SelectionDragRef = MutableRefObject<null | {
    started: boolean;
    additive: boolean;
    startX: number;
    startY: number;
}>;

/**
 * 视口交互子系统：鼠标框选/平移/缩放、触摸捏合/单指拖拽、节点与注释的
 * 拖拽与缩放起始处理。所有事件监听生命周期都在本 hook 内维护。
 */
export function useViewportInteractions({
    viewportRef,
    stateRef,
    state,
    setState,
    viewModeRef,
    animationFrameRef,
}: UseViewportInteractionsParams) {
    const [selectedNodeIds, setSelectedNodeIds] = useState<number[]>([]);
    const [selectionBox, setSelectionBox] = useState<SelectionBox>(null);
    const selectionDragRef = useRef<null | {
        started: boolean;
        additive: boolean;
        startX: number;
        startY: number;
    }>(null);

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

    // 选中项跟随节点删除而收缩
    useEffect(() => {
        setSelectedNodeIds((prev) => prev.filter((id) => state.nodes.some((node) => node.id === id)));
    }, [state.nodes]);

    // ========== 鼠标与滚轮交互 ==========
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
            snapDragTargetToGrid(stateRef.current, setState, animationFrameRef);
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

        const onTouchEnd = (e: TouchEvent) => {
            const touchState = touchStateRef.current;

            // 触摸拖拽结束，执行最终缓动吸附动画
            snapDragTargetToGrid(stateRef.current, setState, animationFrameRef);

            // 重置触摸状态
            touchState.isTouching = false;
            touchState.isPinching = false;
            touchState.initialTouches = [];
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

    // ========== 拖拽/缩放的起始处理 ==========
    const beginDrag = (e: ReactMouseEvent, target: DragTarget) => {
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

    const beginTouchDrag = (e: ReactTouchEvent, target: DragTarget) => {
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

    const beginResize = (e: ReactMouseEvent, commentId: string) => {
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

    const beginTouchResize = (e: ReactTouchEvent, commentId: string) => {
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

    return {
        selectedNodeIds,
        setSelectedNodeIds,
        selectionBox,
        setSelectionBox,
        selectionDragRef,
        beginDrag,
        beginTouchDrag,
        beginResize,
        beginTouchResize,
    };
}
