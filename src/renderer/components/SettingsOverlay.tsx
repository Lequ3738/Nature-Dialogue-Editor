import type { Dispatch, RefObject, SetStateAction } from "react";
import type { CodeStyleProfile } from "../CodeEditor";
import type { ConfigTabs, EditorState, ProjectData } from "../editorTypes";
import { ConfigSidebar } from "../config/ConfigSidebar";
import { ProjectInfoScreen } from "../config/ProjectInfo";
import { VariablesConfigScreen } from "../config/VariablesConfig";
import { CharacterScreen } from "../config/Character";
import { CodeConfigScreen } from "../config/CodeConfig";
import { AboutScreen } from "../config/About";

type SettingsOverlayProps = {
    theme: "dark" | "light";
    settingsTab: ConfigTabs;
    setSettingsTab: Dispatch<SetStateAction<ConfigTabs>>;
    draftProfile: CodeStyleProfile;
    setDraftProfile: Dispatch<SetStateAction<CodeStyleProfile | null>>;
    codeProfile: CodeStyleProfile;
    setCodeProfile: Dispatch<SetStateAction<CodeStyleProfile>>;
    state: EditorState;
    setState: Dispatch<SetStateAction<EditorState>>;
    draftProjectState: ProjectData;
    setDraftProjectState: Dispatch<SetStateAction<ProjectData | null>>;
    setSettingsOpen: Dispatch<SetStateAction<boolean>>;
    setDirty: Dispatch<SetStateAction<boolean>>;
    fileInputRef: RefObject<HTMLInputElement | null>;
    handleImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleExport: () => void;
};

/** 设置对话框：左侧垂直标签栏 + 右侧内容面板 */
export function SettingsOverlay({
    theme,
    settingsTab,
    setSettingsTab,
    draftProfile,
    setDraftProfile,
    codeProfile,
    setCodeProfile,
    state,
    setState,
    draftProjectState,
    setDraftProjectState,
    setSettingsOpen,
    setDirty,
    fileInputRef,
    handleImport,
    handleExport,
}: SettingsOverlayProps) {
    return (
        <div id="config-back">
            <div
                id="config-overlay"
                style={{
                    display: "flex",
                    flexDirection: "row",
                    width: "850px",
                    height: "600px",
                    padding: 0,
                    overflow: "hidden",
                    borderRadius: "8px"
                }}
            >
                {/* --- 左侧垂直标签栏 --- */}
                <ConfigSidebar
                    theme={theme}
                    settingsTab={settingsTab}
                    draftProfile={draftProfile}
                    state={state}
                    draftProjectState={draftProjectState}
                    setSettingsTab={setSettingsTab}
                    setCodeProfile={setCodeProfile}
                    setState={setState}
                    setSettingsOpen={setSettingsOpen}
                    setDirty={setDirty}
                />

                {/* 右侧内容区域 */}
                <div className="settings-content custom-scroll">
                    {/* 1. 项目信息标签 */}
                    {settingsTab === 'info' && (
                        <ProjectInfoScreen
                            theme={theme}
                            codeProfile={codeProfile}
                            draftProjectState={draftProjectState}
                            setDraftProjectState={setDraftProjectState}
                        />
                    )}

                    {settingsTab === 'var' && (
                        <VariablesConfigScreen
                            theme={theme}
                            draftProjectState={draftProjectState}
                            setDraftProjectState={setDraftProjectState}
                        />
                    )}

                    {/* 角色定义 */}
                    {settingsTab === "character" && (
                        <CharacterScreen
                            theme={theme}
                            draftProfile={draftProfile}
                            setDraftProfile={setDraftProfile}
                        />
                    )}

                    {/* 代码编辑器 */}
                    {settingsTab === 'editor' && (
                        <CodeConfigScreen
                            theme={theme}
                            fileInputRef={fileInputRef}
                            draftProfile={draftProfile}
                            handleImport={handleImport}
                            handleExport={handleExport}
                            setCodeProfile={setCodeProfile}
                            setDraftProfile={setDraftProfile}
                        />
                    )}

                    {/* 关于 */}
                    {settingsTab === 'about' && (
                        <AboutScreen theme={theme} />
                    )}
                </div>
            </div>
        </div>
    );
}
