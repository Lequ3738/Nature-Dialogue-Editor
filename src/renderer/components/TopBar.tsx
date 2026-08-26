import { CodeStyleProfile } from "../CodeEditor";
import { addObject } from "../editorLogic";
import { EditorState, ProjectData } from "../editorTypes";

export function TopBar({
    theme, setState, windowSize, fileMenuOpen, setFileMenuOpen, handleOpenClick,
    handleSave, handleSaveAs, handleSaveAndExport, handleExportGml, fileMenuRef, isNewEmpty, fileInputRef, onImport,
    handleThemeChange, setDraftProfile, codeProfile, defaultProfile,
    setDraftProjectState, state, setSettingsOpen, viewMode, setViewMode
} : {
    theme: 'light' | 'dark',
    setState: (value: React.SetStateAction<EditorState>) => void,
    windowSize: { w: number, h: number },
    fileMenuOpen: boolean,
    setFileMenuOpen: (value: React.SetStateAction<boolean>) => void,
    handleOpenClick: () => Promise<void>,
    /** 保存成功返回写入路径，失败/取消返回 null */
    handleSave: () => Promise<string | null>,
    handleSaveAs: () => Promise<string | null>,
    handleSaveAndExport: () => Promise<boolean>,
    handleExportGml: () => Promise<boolean>,
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
    setSettingsOpen: (value: React.SetStateAction<boolean>) => void,
    viewMode: 'graph' | 'text',
    setViewMode: (value: React.SetStateAction<'graph' | 'text'>) => void,
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
                        onClick={handleSaveAndExport}
                        title="保存工程文件，并导出 GML 到上次位置（首次会询问）"
                    >
                        🚀 保存并导出
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
                    <button
                        disabled={isNewEmpty}
                        onClick={handleExportGml}
                        title="由工程文件生成引擎使用的 .gml 文件"
                    >
                        ⬇ 导出 GML
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
                onClick={() => setState(prev => ({
                    ...prev,
                    enableSnapToGrid: !prev.enableSnapToGrid
                }))}
                title={state.enableSnapToGrid ? "关闭网格吸附" : "开启网格吸附"}
                style={{
                    background: state.enableSnapToGrid 
                        ? (theme === "dark" ? "#43b581" : "#3baa71")
                        : undefined,
                }}
            >
                🪟
            </button>
            <button
                className="theme-toggle"
                onClick={() => setState(
                    prev => ({
                        ...prev,
                        view: {
                            ...prev.view,
                            x: windowSize.w / 2 - (windowSize.w / 2 - prev.view.x) / prev.view.zoom,
                            y: windowSize.h / 2 - (windowSize.h / 2 - prev.view.y) / prev.view.zoom,
                            zoom: 1,
                        }
                    })
                )}
            >
                🔍
            </button>
            <button
                className="theme-toggle"
                onClick={() => setViewMode((prev) => (prev === "graph" ? "text" : "graph"))}
                title={viewMode === "graph" ? "切换到文本视图" : "切换到节点视图"}
            >
                {viewMode === "graph" ? "📝" : "🧩"}
            </button>
            <button
                className="theme-toggle"
                onClick={() => handleThemeChange(theme === "dark" ? "light" : "dark")}
                title={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
            >
                {theme === "dark" ? "🌙" : "🌞"}
            </button>
            <button
                className="theme-toggle"
                title="设置"
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