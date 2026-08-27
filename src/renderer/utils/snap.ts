import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { CommentBox, EditorState, Node } from "../editorTypes";
import { snapToGrid } from "../editorLogic";

/**
 * 拖拽结束后的网格吸附缓动动画。
 *
 * 鼠标与触摸两条事件链路在结束时执行完全相同的逻辑，
 * 统一收敛到这里：节点/节点组走 animateNodeToSnapPosition，
 * 注释框走 animateCommentToSnapPosition。
 */

export function snapDragTargetToGrid(
    state: EditorState,
    setState: Dispatch<SetStateAction<EditorState>>,
    animationFrameRef: MutableRefObject<number | null>
): void {
    const dragTarget = state.dragTarget;
    const enableSnap = state.enableSnapToGrid;
    if (dragTarget && enableSnap) {
        if (dragTarget.kind === "node" || dragTarget.kind === "nodeGroup") {
            let targetNodes = [...state.nodes];
            if (dragTarget.kind === "node") {
                targetNodes = targetNodes.map((node) =>
                    node.id === dragTarget.id
                        ? {
                              ...node,
                              x: snapToGrid(node.x, enableSnap),
                              y: snapToGrid(node.y, enableSnap),
                          }
                        : node
                );
            } else {
                targetNodes = targetNodes.map((node) =>
                    dragTarget.ids.includes(node.id)
                        ? {
                              ...node,
                              x: snapToGrid(node.x, enableSnap),
                              y: snapToGrid(node.y, enableSnap),
                          }
                        : node
                );
            }
            animateNodeToSnapPosition(
                state.nodes,
                targetNodes,
                enableSnap,
                (updatedNodes) => setState((prev) => ({ ...prev, nodes: updatedNodes })),
                () => clearDragState(setState),
                animationFrameRef
            );
        } else if (dragTarget.kind === "comment") {
            const comment = state.comments.find((c) => c.id === dragTarget.id);
            if (comment) {
                animateCommentToSnapPosition(
                    comment,
                    enableSnap,
                    setState,
                    animationFrameRef,
                    () => clearDragState(setState)
                );
            }
        }
    } else {
        clearDragState(setState);
    }
}

function clearDragState(setState: Dispatch<SetStateAction<EditorState>>): void {
    setState((prev) => ({
        ...prev,
        isPanning: false,
        lastMouse: undefined,
        dragTarget: null,
        resizing: null,
    }));
}

/**
 * 节点/节点组吸附动画：从当前位置缓动到网格对齐位置。
 */
function animateNodeToSnapPosition(
    nodes: Node[],
    targetNodes: Node[],
    enableSnap: boolean,
    onUpdate: (nodes: Node[]) => void,
    onComplete: () => void,
    animationFrameRef: MutableRefObject<number | null>
): void {
    if (!enableSnap || animationFrameRef.current) return;

    const startTime = performance.now();
    const animationDuration = 150; // 动画时长，可根据手感调整
    const startNodes = [...nodes];

    // 构建每个节点的起始和目标坐标映射
    const nodeAnimations = startNodes
        .map((startNode) => {
            const targetNode = targetNodes.find((n) => n.id === startNode.id);
            if (!targetNode) return null;
            return {
                id: startNode.id,
                startX: startNode.x,
                startY: startNode.y,
                endX: targetNode.x,
                endY: targetNode.y,
            };
        })
        .filter(Boolean) as {
        id: number;
        startX: number;
        startY: number;
        endX: number;
        endY: number;
    }[];
    // 只对真正发生位移的节点做吸附动画；零位移（如纯点击）不重写节点数组，
    // 避免触发脏标记/无意义的重复渲染
    const movableAnimations = nodeAnimations.filter(
        (a) => a.endX !== a.startX || a.endY !== a.startY
    );

    // 无需要动画的节点，直接完成
    if (movableAnimations.length === 0) {
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
        const updatedNodes = startNodes.map((node) => {
            const anim = movableAnimations.find((a) => a.id === node.id);
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
}

/**
 * 注释框吸附动画：与节点动画手感保持一致。
 */
function animateCommentToSnapPosition(
    comment: CommentBox,
    enableSnap: boolean,
    setState: Dispatch<SetStateAction<EditorState>>,
    animationFrameRef: MutableRefObject<number | null>,
    onComplete: () => void
): void {
    const startTime = performance.now();
    const animationDuration = 150;
    const startX = comment.x;
    const startY = comment.y;
    const endX = snapToGrid(comment.x, enableSnap);
    const endY = snapToGrid(comment.y, enableSnap);

    const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / animationDuration, 1);
        const easeProgress = 1 - Math.pow(1 - progress, 3);
        const currentX = startX + (endX - startX) * easeProgress;
        const currentY = startY + (endY - startY) * easeProgress;

        setState((prev) => ({
            ...prev,
            comments: prev.comments.map((c) =>
                c.id === comment.id ? { ...c, x: currentX, y: currentY } : c
            ),
        }));

        if (progress < 1) {
            animationFrameRef.current = requestAnimationFrame(animate);
        } else {
            animationFrameRef.current = null;
            onComplete();
        }
    };

    animationFrameRef.current = requestAnimationFrame(animate);
}
