import { CodeStyleProfile } from "../CodeEditor";
import { ConfigTabs, EditorState, ProjectData } from "../editorTypes";

export function ConfigSidebar({
    theme, settingsTab, draftProfile, state, draftProjectState, setSettingsTab, 
    setCodeProfile, setState, setSettingsOpen, setDirty,
} : {
    theme: 'light' | 'dark',
    settingsTab: ConfigTabs,
    draftProfile: CodeStyleProfile,
    state: EditorState,
    draftProjectState: ProjectData,
    setSettingsTab: (value: React.SetStateAction<ConfigTabs>) => void,
    setCodeProfile: (value: React.SetStateAction<CodeStyleProfile>) => void,
    setState: (value: React.SetStateAction<EditorState>) => void,
    setSettingsOpen: (value: React.SetStateAction<boolean>) => void,
    setDirty: (value: React.SetStateAction<boolean>) => void,
}) {
    return (
        <div className="settings-sidebar">
            <div className="settings-sidebar-top">
                <div className="settings-sidebar-title">项目设置</div>
                <button
                    className={`settings-tab ${settingsTab === 'info' ? 'active' : ''}`}
                    onClick={() => setSettingsTab('info')}
                >
                    项目信息
                </button>
                <button
                    className={`settings-tab ${settingsTab === 'var' ? 'active' : ''}`}
                    onClick={() => setSettingsTab('var')}
                >
                    自定义变量
                </button>
                <button
                    className={`settings-tab ${settingsTab === "character" ? 'active' : ''}`}
                    onClick={() => setSettingsTab("character")}
                >
                    角色定义
                </button>
                <button
                    className={`settings-tab ${settingsTab === 'editor' ? 'active' : ''}`}
                    onClick={() => setSettingsTab('editor')}
                >
                    代码编辑器
                </button>
                <button
                    className={`settings-tab ${settingsTab === 'about' ? 'active' : ''}`}
                    onClick={() => setSettingsTab('about')}
                >
                    关于
                </button>
            </div>

            {/* 左下角：保存与取消按钮 */}
            <div style={{
                display: "flex", gap: 10, padding: "12px 16px", 
                borderTop: `1px solid ${theme === "dark" ? "#444" : "#DDD"}`
            }}>
                <button
                    onClick={() => setSettingsOpen(false)}
                    className="secondary-button"
                    style={{ flex: 1 }}
                >
                    取消
                </button>
                <button
                    onClick={() => {
                        setCodeProfile(draftProfile);

                        // 判断数据是否改变
                        const originalProject = {
                            title: state.title,
                            author: state.author,
                            version: state.version,
                            description: state.description,
                            forbiddenExpression: state.forbiddenExpression,
                            variables: state.variables,
                        };
                        const hasChanges = JSON.stringify(originalProject) !== JSON.stringify(draftProjectState);

                        // 保存草稿数据
                        if (draftProjectState) {
                            setState(prev => ({
                                ...prev,
                                title: draftProjectState.title,
                                author: draftProjectState.author,
                                version: draftProjectState.version,
                                description: draftProjectState.description,
                                forbiddenExpression: draftProjectState.forbiddenExpression,
                                variables: draftProjectState.variables,
                            }));
                        }

                        if (hasChanges)
                            setDirty(true);
                        
                        setSettingsOpen(false);
                    }}
                    style={{ flex: 1 }}
                >
                    保存
                </button>
            </div>
        </div>
    );
}