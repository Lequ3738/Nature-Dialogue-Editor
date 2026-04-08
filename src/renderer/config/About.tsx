export function AboutScreen({ theme }: { theme: 'light' | 'dark' })
{
    return (
        <div className="settings-section">
            <h3>关于</h3>
            <div className="settings-section" style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                textAlign: 'center',
                justifyContent: 'center', // 垂直居中
                padding: '20px 0'
            }}>
                {/* 软件大标题 */}
                <h2 style={{ 
                    margin: 0, 
                    fontSize: '28px', 
                    fontWeight: 800,
                    background: theme === 'dark' 
                        ? 'linear-gradient(135deg, #fff 0%, #aaa 100%)' 
                        : 'linear-gradient(135deg, #1f2937 0%, #4b5563 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text'
                }}>
                    对话编辑器
                </h2>
                
                {/* 版本号 */}
                <p style={{ 
                    margin: '8px 0 24px 0', 
                    fontSize: '14px', 
                    opacity: 0.6,
                    letterSpacing: '1px'
                }}>
                    版本 1.0.0
                </p>

                {/* 分割线 */}
                <div style={{ 
                    width: '40px', 
                    height: '3px', 
                    background: 'var(--accent)', 
                    borderRadius: '999px',
                    marginBottom: '24px'
                }} />

                {/* 作者与描述 */}
                <div style={{ maxWidth: '420px', marginBottom: '32px' }}>
                    <p style={{ margin: '0 0 12px 0', fontWeight: 600, fontSize: '15px' }}>
                        作者：Lequ
                    </p>
                    <p style={{ 
                        margin: 0, 
                        fontSize: '14px', 
                        lineHeight: '1.7', 
                        opacity: 0.85
                    }}>
                        本程序专为游戏
                        <span style={{ fontWeight: 600, opacity: 1 }}> I want Nature </span>
                        设计，用于通过有向图可视化编辑对话走向，并编译导出对应的 GML 代码逻辑。
                    </p>
                </div>

                {/* 技术栈标题 */}
                <p style={{ 
                    margin: '0 0 16px 0', 
                    fontSize: '12px', 
                    textTransform: 'uppercase', 
                    letterSpacing: '2px',
                    opacity: 0.5
                }}>
                    Powered by
                </p>

                {/* 技术栈图标墙 (横向排列) */}
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'center', 
                    alignItems: 'flex-start',
                    gap: '32px', // 图标之间的间距
                    flexWrap: 'wrap'
                }}>
                    {/* Electron */}
                    <div style={{
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', gap: '8px'
                    }}>
                        <div style={{ 
                            width: '64px', 
                            height: '64px', 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center',
                            background: theme === 'dark' ? 
                                'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                            borderRadius: '12px',
                            border: `1px solid ${
                                theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'
                            }`
                        }}>
                            <img 
                                src="src/resources/electron.svg" 
                                alt="Electron" 
                                style={{ width: '32px', height: '32px', objectFit: 'contain' }}
                            />
                        </div>
                        <span style={{ fontSize: '13px', fontWeight: 500 }}>Electron</span>
                    </div>

                    {/* React */}
                    <div style={{
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', gap: '8px'
                    }}>
                        <div style={{ 
                            width: '64px', 
                            height: '64px', 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center',
                            background: theme === 'dark' ? 
                                'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                            borderRadius: '12px',
                            border: `1px solid ${
                                theme === 'dark' ? 
                                'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'
                            }`
                        }}>
                            <img 
                                src={`src/resources/react_${
                                    theme === "light" ? "light" : "dark"
                                }.svg`} 
                                alt="React" 
                                style={{ width: '32px', height: '32px', objectFit: 'contain' }}
                            />
                        </div>
                        <span style={{ fontSize: '13px', fontWeight: 500 }}>React</span>
                    </div>

                    {/* Vite */}
                    <div style={{
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', gap: '8px'
                    }}>
                        <div style={{ 
                            width: '64px', 
                            height: '64px', 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center',
                            background: theme === 'dark' ? 
                                'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                            borderRadius: '12px',
                            border: `1px solid ${
                                theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'
                            }`
                        }}>
                            <img 
                                src={`src/resources/vite_${
                                    theme === "light" ? "light" : "dark"
                                }.svg`} 
                                alt="Vite" 
                                style={{ width: '32px', height: '32px', objectFit: 'contain' }}
                            />
                        </div>
                        <span style={{ fontSize: '13px', fontWeight: 500 }}>Vite</span>
                    </div>
                </div>
            </div>
        </div>
    );
}