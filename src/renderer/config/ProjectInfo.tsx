import CodeEditor, { CodeStyleProfile } from "../CodeEditor";
import { ProjectData } from "../editorTypes";

export function ProjectInfoScreen({ theme, codeProfile, draftProjectState, setDraftProjectState } : {
    theme: 'light' | 'dark',
    codeProfile: CodeStyleProfile,
    draftProjectState: ProjectData | null,
    setDraftProjectState: (value: React.SetStateAction<ProjectData | null>) => void,
}) {
    return (
        <div className="settings-section">
            <h3>项目信息</h3>

            <div className="form-group-row">
                <label style={{ paddingTop: 8 }}>项目标题：</label>
                <input
                    type="text"
                    className="textarea-styled"
                    style={{ display: "flex", marginLeft: "auto", width: 500 }}
                    placeholder="输入项目名称"
                    value={ draftProjectState?.title || "" }
                    onChange={ e => setDraftProjectState(
                        prev => prev ? { ...prev, title: e.target.value } : null
                    )}
                />
            </div>
            <div className="form-group-row">
                <label style={{ paddingTop: 8 }}>作者：</label>
                <input
                    type="text"
                    className="textarea-styled"
                    placeholder="输入作者名称"
                    style={{ display: "flex", marginLeft: "auto", width: 500 }}
                    value={ draftProjectState?.author || "" }
                    onChange={ e => setDraftProjectState(
                        prev => prev ? { ...prev, author: e.target.value } : null
                    )}
                />
            </div>
            <div className="form-group-row">
                <label style={{ paddingTop: 8 }}>版本号：</label>
                <input
                    type="text"
                    className="textarea-styled"
                    placeholder="输入版本号（如 1.0.0）"
                    style={{ display: "flex", marginLeft: "auto", width: 500 }}
                    value={ draftProjectState?.version || "" }
                    onChange={ e => setDraftProjectState(
                        prev => prev ? { ...prev, version: e.target.value } : null
                    )}
                />
            </div>
            <div className="form-group-row">
                <label style={{ paddingTop: 8 }}>描述：</label>
                <input
                    type="text"
                    className="textarea-styled"
                    placeholder="输入项目的描述文本"
                    style={{ display: "flex", marginLeft: "auto", width: 500 }}
                    value={ draftProjectState?.description || "" }
                    onChange={ e => setDraftProjectState(
                        prev => prev ? { ...prev, description: e.target.value } : null
                    )}
                />
            </div>
            <div className="form-group">
                <label>对话禁用表达式：</label>
                <CodeEditor
                    value={ draftProjectState?.forbiddenExpression || "" }
                    onChange={ next => setDraftProjectState(
                        prev => prev ? {...prev, forbiddenExpression: next} : null
                    )}
                    profile={codeProfile}
                    theme={theme}
                    height={180}
                />
            </div>
        </div>
    );
}