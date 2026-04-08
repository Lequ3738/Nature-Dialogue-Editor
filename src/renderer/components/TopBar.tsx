import { CodeStyleProfile } from "../CodeEditor";
import { addObject } from "../editorLogic";
import { EditorState, ProjectData } from "../editorTypes";

export function TopBar({
    theme, setState, windowSize, fileMenuOpen, setFileMenuOpen, handleOpenClick, 
    handleSave, handleSaveAs, fileMenuRef, isNewEmpty, fileInputRef, onImport,
    handleThemeChange, setDraftProfile, codeProfile, defaultProfile, 
    setDraftProjectState, state, setSettingsOpen
} : {
    theme: 'light' | 'dark',
    setState: (value: React.SetStateAction<EditorState>) => void,
    windowSize: { w: number, h: number },
    fileMenuOpen: boolean,
    setFileMenuOpen: (value: React.SetStateAction<boolean>) => void,
    handleOpenClick: () => Promise<void>,
    handleSave: () => Promise<boolean>,
    handleSaveAs: () => Promise<boolean>,
    fileMenuRef: React.RefObject<HTMLDivElement | null>,
    isNewEmpty: boolean,
    fileInputRef: React.RefObject<HTMLInputElement | null>,
    onImport: (file: File) => void,
    handleThemeChange: (theme: 'light' | 'dark') => void,
    setDraftProfile: (value: React.SetStateAction<CodeStyleProfile | null>) => void,
    codeProfile: CodeStyleProfile,
    defaultProfile: CodeStyleProfile,
    setDraftProjectState: (value: React.SetStateAction<ProjectData | null>) => void,
    state: EditorState,
    setSettingsOpen: (value: React.SetStateAction<boolean>) => void
}) {
    return (
        <div id="toolbar">
            <button
                onClick={() => {
                    setState((prev) =>
                        addObject(prev, "node", windowSize.w, windowSize.h)
                    );
                }}
            >
                + 对话
            </button>
            <button
                onClick={() => {
                    setState((prev) =>
                        addObject(prev, "condition", windowSize.w, windowSize.h)
                    );
                }}
                style={theme === "dark" ?
                    { background: "#bf6b21" } :
                    { background: "#e67e22" }
                }
            >
                + 条件
            </button>
            <button
                onClick={() => {
                    setState((prev) =>
                        addObject(prev, "comment", windowSize.w, windowSize.h)
                    );
                }}
                style={theme === "dark" ?
                    { background: "#288856" } :
                    { background: "#3baa71" }
                }
            >
                + 注释
            </button>
            <button
                onClick={() => {
                    setState((prev) =>
                        addObject(prev, "start", windowSize.w, windowSize.h)
                    );
                }}
                style={theme === "dark" ?
                    { background: "#ae3fb6" } :
                    { background: "#da57e3" }
                }
            >
                + 开始
            </button>
            <button
                onClick={() => {
                    setState((prev) =>
                        addObject(prev, "end", windowSize.w, windowSize.h)
                    );
                }}
                style={theme === "dark" ?
                    { background: "#828f90" } :
                    { background: "#96a4a5" }
                }
            >
                + 结束
            </button>
            <div style={{ flexGrow: 1 }} />
            <div className={`file-menu ${fileMenuOpen ? "open" : ""}`} ref={fileMenuRef}>
                <button
                    className="file-menu-button"
                    onClick={(e) => {
                        e.stopPropagation();
                        setFileMenuOpen((v) => !v);
                    }}
                >
                    文件 ▾
                </button>
                <div className="file-menu-dropdown" role="menu">
                    <button
                        onClick={handleOpenClick}
                    >
                        📖 打开
                    </button>
                    <button
                        disabled={isNewEmpty}
                        onClick={handleSave}
                    >
                        💾 保存
                    </button>
                    <button
                        disabled={isNewEmpty}
                        onClick={handleSaveAs}
                    >
                        💿 另存为
                    </button>
                </div>
            </div>
            <input
                type="file"
                ref={fileInputRef}
                id="importInput"
                hidden
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onImport(f);
                }}
            />
            <button
                className="theme-toggle"
                onClick={() => handleThemeChange(theme === "dark" ? "light" : "dark")}
            >
                {theme === "dark" ? "🌙" : "🌞"}
            </button>
            <button
                className="theme-toggle"
                onClick={() => {
                    // 将当前主题的配置克隆一份到草稿中
                    setDraftProfile(codeProfile || defaultProfile);
                    setDraftProjectState({
                        title: state.title,
                        author: state.author,
                        version: state.version,
                        description: state.description,
                        forbiddenExpression: state.forbiddenExpression,
                        variables: structuredClone(state.variables),
                    });

                    setSettingsOpen(true);
                }}
            >⚙️</button>
        </div>
    );
}