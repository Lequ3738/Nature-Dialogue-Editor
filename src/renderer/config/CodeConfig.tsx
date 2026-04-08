import { useEffect, useState } from "react";
import { getIpcRenderer } from "../App";
import { CodeStyleProfile, KeywordGroup, KeywordType } from "../CodeEditor";
import { defaultProfile } from "../editorTypes";

export function CodeConfigScreen({
        theme, fileInputRef, draftProfile, handleImport, handleExport, setCodeProfile, 
        setDraftProfile,
    } : {
        theme: 'light' | 'dark',
        fileInputRef: React.RefObject<HTMLInputElement | null>,
        draftProfile: CodeStyleProfile,
        handleImport: (e: React.ChangeEvent<HTMLInputElement>) => void,
        handleExport: () => void,
        setCodeProfile: (value: React.SetStateAction<CodeStyleProfile>) => void,
        setDraftProfile: (value: React.SetStateAction<CodeStyleProfile | null>) => void,
    }
) {
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%', // 强制占满右侧设置区的全部高度
            gap: "13px",
        }}>
            {/* 头部标题+操作按钮 固定不滚动 */}
            <div id="config"
                style={{
                    borderBottom: theme === "dark" ? "1px solid #444" : "1px solid #DDD",
                    flexShrink: 0, // 禁止压缩
                    marginTop: 2 
                }}>
                <h3 style={{ margin: 0, marginTop: 6  }}>代码编辑器</h3>
                {/* 右对齐的按钮容器 */}
                <div style={{ display: "flex", gap: 10, marginTop: 0 }}>
                    {/* 隐藏的真实输入框 */}
                    <input
                        type="file" ref={fileInputRef}
                        style={{ display: "none" }}
                        accept=".txt" onChange={handleImport}
                    />
                    <button
                        onClick={async () => {
                            const ipc = getIpcRenderer();
                            if (!ipc) return;
                            const result = await ipc.invoke("editor:default-profile") as number;
                            if (result > 0) {
                                setCodeProfile(defaultProfile);
                            }
                        }}
                        className="secondary-button imp-exp-button"
                    >
                        恢复默认配置
                    </button>
                    {/* 导入按钮 */}
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="secondary-button imp-exp-button"
                    >
                        导入配置
                    </button>
                    {/* 导出按钮 */}
                    <button
                        onClick={handleExport}
                        className="secondary-button imp-exp-button"
                    >
                        导出配置
                    </button>
                </div>
            </div>

            {/* 字体设置 固定不滚动 */}
            <div style={{
                display: "flex",
                alignItems: 'center',
                borderBottom: theme === "dark" ? "1px solid #444" : "1px solid #DDD",
                paddingBottom: 15,
                flexShrink: 0, // 禁止压缩
                gap: 12
            }}>
                <label
                    style={{ marginBottom: 0, whiteSpace: 'nowrap' }}
                >
                    字体系列：
                </label>
                <input
                    className="textarea-styled"
                    style={{ flex: 1, padding: 8 }}
                    value={draftProfile.fontFamily}
                    onChange={e => setDraftProfile({ ...draftProfile, fontFamily: e.target.value })}
                />
                <label
                    style={{ marginBottom: 0, whiteSpace: 'nowrap' }}
                >
                    大小：
                </label>
                <input
                    type="number"
                    className="textarea-styled"
                    style={{ width: 80, padding: 8 }}
                    value={draftProfile.fontSize}
                    onChange={e => setDraftProfile({ 
                        ...draftProfile, 
                        fontSize: Number(e.target.value)
                    })}
                />
            </div>

            {/* 关键字分组标题 固定不滚动 */}
            <h4 style={{ margin: 0, flexShrink: 0 }}>自定义高亮</h4>

            {/* 分组列表 自适应占满剩余空间，仅此处滚动 */}
            <div style={{
                borderRadius: 8,
                flex: 1, // 核心：自动占满剩余高度
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 16,
                color: "var(--text)"
            }} className="custom-scroll">
                {draftProfile.keywordGroups?.map((group, index) => (
                    <GroupEditor
                        key={group.id}
                        group={group}
                        theme={theme}
                        onChange={(updatedGroup) => {
                            const newGroups = [...draftProfile.keywordGroups];
                            newGroups[index] = updatedGroup;
                            setDraftProfile({ ...draftProfile, keywordGroups: newGroups });
                        }}
                        onDelete={() => {
                            const newGroups = draftProfile.keywordGroups.filter((_, i) => i !== index);
                            setDraftProfile({ ...draftProfile, keywordGroups: newGroups });
                        }}
                    />
                ))}
            </div>

            {/* 添加按钮 固定在底部，永远不随内容滚动、不随窗口大小偏移 */}
            <button
                onClick={() => {
                    const newGroups = [
                        ...draftProfile.keywordGroups,
                        {
                            id: Date.now().toString(),
                            name: "新分组", type: "function" as KeywordType,
                            colorDark: "#ffffff", colorLight: "#000000",
                            keywords: []
                        }
                    ];
                    setDraftProfile({ ...draftProfile, keywordGroups: newGroups });
                }}
                style={{ flexShrink: 0, marginTop: 8 }}
            >
                + 添加关键字分组
            </button>
        </div>
    );
}

// 设置面板内部组件，用于处理单个分组，解决空格 Bug
function GroupEditor({ group, theme, onChange, onDelete }: {
    group: KeywordGroup;
    theme: "dark" | "light";
    onChange: (g: KeywordGroup) => void;
    onDelete: () => void;
}) {
    // 使用本地 state 维护关键字字符串，解决空格输入时由于重绘导致光标和空格丢失的问题
    const [rawKeywords, setRawKeywords] = useState(group.keywords.join(" "));

    useEffect(() => {
        // 比较当前输入框的单词，和外部 (group.keywords) 的单词是否一致
        const currentArr = rawKeywords.split(/\s+/).filter(Boolean);
        const isSame = currentArr.length === group.keywords.length &&
            currentArr.every((k, i) => k === group.keywords[i]);

        // 只有当真正不一致时（即触发了导入配置），才强制覆盖文本框内容
        // 这样既能实现导入后自动刷新，又不会在正常打字时吃掉结尾的空格
        if (!isSame) {
            setRawKeywords(group.keywords.join(" "));
        }
    }, [group.keywords, rawKeywords]);

    const handleTextChange = (val: string) => {
        setRawKeywords(val); // 保持输入框原始状态，允许尾随空格

        // 过滤出干净的单词数组存入配置，防止出现空字符串高亮报错
        const keywordsArray = val.split(/\s+/).filter(Boolean);
        onChange({ ...group, keywords: keywordsArray });
    };

    return (
        <div className="variable-row" style={{
            border: theme === "dark" ? "1px solid #444" : "1px solid #DDD",
            borderRadius: 8, padding: 12, marginBottom: 12
        }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                <select
                    onChange={e => onChange({ ...group, type: e.target.value as KeywordType })}
                    value={group.type}
                >
                    <option value="function">函数</option>
                    <option value="variable">变量</option>
                    <option value="keyword">关键字</option>
                    <option value="constant">常量</option>
                </select>
                <input
                    placeholder="分组名称"
                    className="textarea-styled"
                    style={{ flex: 1, padding: 8, width: "50%" }}
                    value={group.name}
                    onChange={e => onChange({ ...group, name: e.target.value })}
                />
                <button
                    style={{ background: "#ed4245" }}
                    onClick={onDelete}
                >
                    删除
                </button>
                <div style={{ display: "flex", alignItems: "center" }}>
                    <label>浅色：</label>
                    <input type="color"
                        value={group.colorLight}
                        onChange={e => onChange({ ...group, colorLight: e.target.value })}
                    />
                </div>
                <div style={{ display: "flex", alignItems: "center" }}>
                    <label>深色：</label>
                    <input type="color"
                        value={group.colorDark}
                        onChange={e => onChange({ ...group, colorDark: e.target.value })}
                    />
                </div>
            </div>
            <textarea
                rows={4}
                className="custom-scroll"
                style={{ width: "97%" }}
                placeholder="在此输入关键字，并使用空格分隔不同的关键字。"
                value={rawKeywords}
                onChange={e => handleTextChange(e.target.value)}
                spellCheck="false"
            />
        </div>
    );
}