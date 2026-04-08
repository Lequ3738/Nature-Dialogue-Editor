import { ModalDraft, PRESET_COLORS } from "../App";
import CodeEditor, { CodeStyleProfile } from "../CodeEditor";
import { Node } from "../editorTypes"

export function EditingCommentWindows({ 
    commentDraft, setCommentDraft, commentColorDraft, setCommentColorDraft,
    deleteComment, closeCommentModal, saveCommentModal,
} : {
    commentDraft: string,
    setCommentDraft: (value: React.SetStateAction<string>) => void,
    commentColorDraft: string,
    setCommentColorDraft: (value: React.SetStateAction<string>) => void,
    deleteComment: () => void,
    closeCommentModal: () => void,
    saveCommentModal: () => void,
}) {
    return (
        <div id="modal-overlay" style={{ display: "flex" }}>
            <div id="modal">
                <h3 style={{ margin: 0 }}>注释配置</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label style={{ fontSize: 12, color: "#888" }}>注释文字</label>
                    <textarea
                        rows={4}
                        value={commentDraft}
                        onChange={(e) => setCommentDraft(e.target.value)}
                        className="custom-scroll"
                    />
                </div>
                <div className="color-row">
                    <label>注释颜色:</label>
                    <input
                        type="color"
                        value={commentColorDraft}
                        onChange={(e) => setCommentColorDraft(e.target.value)}
                    />
                    <div className="preset-color-list">
                        {PRESET_COLORS.map((color) => (
                            <button
                                key={color}
                                className={`preset-color ${commentColorDraft === color ? "active" : ""}`}
                                style={{ background: color }}
                                onClick={() => setCommentColorDraft(color)}
                                title={color}
                            />
                        ))}
                    </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <button onClick={deleteComment} style={{ background: "#f04747" }}>
                        删除注释框
                    </button>
                    <div style={{ display: "flex", gap: 10 }}>
                        <button
                            onClick={closeCommentModal}
                            className="secondary-button"
                        >
                            取消
                        </button>
                        <button onClick={saveCommentModal}>保存</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function EditingNodeWindows({
    theme, editingNode, draft, setDraft, codeProfile, deleteCurrent,
    closeModal, saveModal
} : {
    theme: 'light' | 'dark',
    editingNode: Node | null,
    draft: ModalDraft,
    setDraft: (value: React.SetStateAction<ModalDraft>) => void,
    codeProfile: CodeStyleProfile,
    deleteCurrent: () => void,
    closeModal: () => void,
    saveModal: () => void,
}) {
    return (
        <div id="modal-overlay" style={{ display: "flex", }}>
            <div id="modal">
                <h3 id="m-title" style={{ margin: 0 }}>
                    节点配置
                </h3>

                {(editingNode?.type !== "condition" && editingNode?.type !== "end" &&
                    editingNode?.type !== "start") ? (
                    <div className="lang-box">
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            <label style={{ fontSize: 12, color: "#888" }}>中文</label>
                            <textarea
                                id="m-cn"
                                className="custom-scroll"
                                rows={4}
                                value={draft.cn}
                                onChange={(e) =>
                                    setDraft((d) => ({ ...d, cn: e.target.value }))
                                }
                            />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            <label style={{ fontSize: 12, color: "#888" }}>英文</label>
                            <textarea
                                id="m-en"
                                className="custom-scroll"
                                rows={4}
                                value={draft.en}
                                onChange={(e) =>
                                    setDraft((d) => ({ ...d, en: e.target.value }))
                                }
                            />
                        </div>
                    </div>
                ) : null}

                {editingNode?.type !== "start" ?
                    <>
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            <label style={{ fontSize: 12, color: "#888" }}>执行代码</label>
                            <CodeEditor
                                value={draft.code}
                                onChange={(next) => setDraft((d) => ({ ...d, code: next }))}
                                profile={codeProfile}
                                theme={theme}
                                height={180}
                            />
                        </div>
                    </> : null
                }

                <div className="color-row">
                    <label>自定义颜色:</label>
                    <input
                        type="color"
                        id="m-color"
                        value={draft.color}
                        onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
                    />
                    <div className="preset-color-list">
                        {PRESET_COLORS.map((color) => (
                            <button
                                key={color}
                                className={`preset-color ${draft.color === color ? "active" : ""}`}
                                style={{ background: color }}
                                onClick={() => setDraft((d) => ({ ...d, color }))}
                                title={color}
                            />
                        ))}
                    </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <button onClick={deleteCurrent} style={{ background: "#f04747" }}>
                        删除此节点
                    </button>
                    <div style={{ display: "flex", gap: 10 }}>
                        <button onClick={closeModal} className="secondary-button">
                            取消
                        </button>
                        <button onClick={saveModal}>保存</button>
                    </div>
                </div>
            </div>
        </div>
    );
}