import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { EditorState, ModalDraft } from "../editorTypes";
import { characterNone } from "../editorTypes";

/**
 * 节点/注释编辑弹窗子系统：编辑中的 id、草稿数据，以及打开/保存/删除逻辑。
 */
export function useNodeEditing(
    state: EditorState,
    setState: Dispatch<SetStateAction<EditorState>>
) {
    const [editingId, setEditingId] = useState<number | null>(null);
    const [draft, setDraft] = useState<ModalDraft>({ cn: "", en: "", code: "", color: "#7289da", character: characterNone, tag: "" });
    const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
    const [commentDraft, setCommentDraft] = useState<string>("");
    const [commentColorDraft, setCommentColorDraft] = useState<string>("#5865f2");

    const openModal = (id: number) => {
        setEditingId(id);
        const n = state.nodes.find((x) => x.id === id);
        if (n) setDraft({ cn: n.cn, en: n.en, code: n.code, color: n.color, character: n.character, tag: n.tag ?? "" });
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
                return {
                    ...n,
                    cn: draft.cn, en: draft.en,
                    code: draft.code, color: draft.color,
                    character: draft.character,
                    tag: draft.tag,
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

    return {
        editingId,
        draft,
        setDraft,
        editingNode,
        openModal,
        closeModal,
        saveModal,
        deleteCurrent,
        editingCommentId,
        commentDraft,
        setCommentDraft,
        commentColorDraft,
        setCommentColorDraft,
        openCommentModal,
        closeCommentModal,
        saveCommentModal,
        deleteComment,
    };
}
