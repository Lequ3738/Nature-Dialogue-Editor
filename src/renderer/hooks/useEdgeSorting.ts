import { useMemo, useState } from "react";
import type { EditorState, Node } from "../editorTypes";

/**
 * 连线排序弹窗子系统：当前正在排序的节点、其 default 连线条目、目标节点查询。
 */
export function useEdgeSorting(state: EditorState) {
    const [sortingEdgeNodeId, setSortingEdgeNodeId] = useState<number | null>(null);

    // 获取当前排序节点的连出default连线
    const sortingEdgeList = useMemo(() => {
        if (sortingEdgeNodeId === null) return [];
        return state.edges.filter(e => e.fromId === sortingEdgeNodeId && e.type === "default");
    }, [sortingEdgeNodeId, state.edges]);

    // 获取连线对应的目标节点信息
    const getTargetNode = (toId: number): Node | undefined => {
        return state.nodes.find(n => n.id === toId);
    };

    // 关闭排序弹窗
    const closeSortModal = () => {
        setSortingEdgeNodeId(null);
    };

    return {
        sortingEdgeNodeId,
        setSortingEdgeNodeId,
        sortingEdgeList,
        getTargetNode,
        closeSortModal,
    };
}
