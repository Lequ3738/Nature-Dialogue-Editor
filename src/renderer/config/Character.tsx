import { CodeStyleProfile } from "../CodeEditor";
import { Character } from "../editorTypes";

export function CharacterScreen({ theme, draftProfile, setDraftProfile } : {
    theme: 'light' | 'dark',
    draftProfile: CodeStyleProfile,
    setDraftProfile: (value: React.SetStateAction<CodeStyleProfile | null>) => void,
}) {
    // 添加新角色
    const handleDraftAddCharacter = () => {
        if (!draftProfile) return;
        const newCharacter: Character = {
            id: Date.now().toString(),
            name: "新角色",
            constantName: `CHAR_${Date.now().toString().slice(-6)}`,
            remark: "",
        };
        setDraftProfile(prev => prev ? {
            ...prev,
            characters: [...prev.characters, newCharacter]
        } : null);
    };

    // 更新角色属性
    const handleDraftUpdateCharacter = (id: string, key: keyof Character, value: any) => {
        if (!draftProfile) return;
        setDraftProfile(prev => {
            if (!prev) return null;
            return {
                ...prev,
                characters: prev.characters.map((item) => {
                    if (item.id !== id) return item;
                    return { ...item, [key]: value };
                })
            };
        });
    };

    // 删除角色
    const handleDraftDeleteCharacter = (id: string) => {
        if (!draftProfile) return;
        setDraftProfile(prev => prev ? {
            ...prev,
            characters: prev.characters.filter(item => item.id !== id)
        } : null);
    };
    
    return (
        <div className="settings-section" style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            height: '100%',
            gap: '16px',
            padding: 0,
        }}>
            {/* 标题区域 - 固定不滚动，与其他界面风格统一 */}
            <div style={{ 
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: 1,
                paddingBottom: 7,
                borderBottom: `1px solid ${theme === "dark" ? "#444" : "#DDD"}`,
                flexShrink: 0,
            }}>
                <h3 style={{ margin: 0 }}>角色定义</h3>
                {/* 标题右侧：全局批量颜色设置，效仿代码编辑器界面 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <label>浅色：</label>
                        <input 
                            type="color"
                            value={ draftProfile.characterColorLight }
                            onChange={(e) => {
                                if (!draftProfile) return;
                                setDraftProfile(prev => prev ? {
                                    ...prev,
                                    characterColorLight: e.target.value,
                                } : null);
                            }}
                        />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <label>深色：</label>
                        <input 
                            type="color"
                            value={ draftProfile.characterColorDark }
                            onChange={(e) => {
                                if (!draftProfile) return;
                                setDraftProfile(prev => prev ? {
                                    ...prev,
                                    characterColorDark: e.target.value,
                                } : null);
                            }}
                        />
                    </div>
                </div>
            </div>

            {/* 角色卡片网格 */}
            <div 
                className="custom-scroll"
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                    gap: '16px',
                    paddingRight: 4,
                    paddingBottom: 8,
                    alignContent: 'start',
                }}
            >
                {/* 空状态提示 */}
                {(draftProfile?.characters || []).length === 0 ? (
                    <div style={{
                        gridColumn: '1 / -1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '120px',
                        fontSize: '14px',
                        opacity: 0.5,
                        color: 'var(--text)'
                    }}>
                        暂无角色定义，点击下方按钮添加
                    </div>
                ) : (
                    // 角色卡片循环
                    (draftProfile?.characters || []).map((character) => (
                        <div
                            key={character.id}
                            className="character-card"
                        >
                            {/* 角色中文名输入框 */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '12px', color: '#888' }}>角色名称</label>
                                <input
                                    type="text"
                                    value={character.name}
                                    onChange={(e) => handleDraftUpdateCharacter(character.id, 'name', e.target.value)}
                                    placeholder="输入角色名称"
                                    className="textarea-styled"
                                    style={{
                                        padding: '8px 10px',
                                        width: '100%',
                                        boxSizing: 'border-box',
                                    }}
                                />
                            </div>

                            {/* 常量名输入框 */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '12px', color: '#888' }}>常量名</label>
                                <input
                                    type="text"
                                    value={character.constantName}
                                    onChange={(e) => handleDraftUpdateCharacter(character.id, 'constantName', e.target.value)}
                                    placeholder="输入常量名称"
                                    className="textarea-styled"
                                    style={{
                                        padding: '8px 10px',
                                        width: '100%',
                                        boxSizing: 'border-box',
                                    }}
                                />
                            </div>

                            {/* 固定高度多行备注输入框 */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                                <label style={{ fontSize: '12px', color: '#888' }}>备注</label>
                                <textarea
                                    rows={4}
                                    value={character.remark}
                                    onChange={(e) => handleDraftUpdateCharacter(character.id, 'remark', e.target.value)}
                                    placeholder="输入备注信息"
                                    className="custom-scroll"
                                    style={{
                                        padding: '8px 10px',
                                        width: '100%',
                                        resize: 'none', // 固定高度，禁止拉伸
                                        minHeight: '80px',
                                        boxSizing: 'border-box',
                                    }}
                                />
                            </div>

                            <button
                                onClick={() => handleDraftDeleteCharacter(character.id)}
                                style={{
                                    background: '#f04747',
                                    maxWidth: 60,
                                    margin: "auto",
                                }}
                                title="删除角色"
                            >
                                删除
                            </button>
                        </div>
                    ))
                )}
            </div>

            {/* 底部固定：占满全宽的添加角色按钮 */}
            <button onClick={handleDraftAddCharacter}>
                + 添加角色
            </button>
        </div>
    );
}