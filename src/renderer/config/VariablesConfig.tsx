import React, { useEffect, useState } from "react";
import { CustomVariable, ProjectData } from "../editorTypes";

export function VariablesConfigScreen({ theme, draftProjectState, setDraftProjectState } : {
    theme: 'light' | 'dark',
    draftProjectState: ProjectData | null,
    setDraftProjectState: (value: React.SetStateAction<ProjectData | null>) => void,
}) {
    // 添加新变量
    const handleDraftAddVariable = () => {
        if (!draftProjectState) return;
        const newVariable: CustomVariable = {
            id: Date.now().toString(),
            persistent: false,
            type: "number",
            name: `var_${Date.now().toString().slice(-6)}`,
            value: 0,
        };
        setDraftProjectState(prev => prev ? {
            ...prev,
            variables: [...prev.variables, newVariable]
        } : null);
    };

    // 更新变量属性
    const handleDraftUpdateVariable = (id: string, key: keyof CustomVariable, value: any) => {
        if (!draftProjectState) return;
        setDraftProjectState(prev => {
            if (!prev) return null;
            return {
                ...prev,
                variables: prev.variables.map((item) => {
                    if (item.id !== id) return item;
                    // 类型切换时自动转换值格式
                    if (key === "type") {
                        const newType = value as "number" | "string";
                        let newValue = item.value;
                        if (newType === "number") {
                            newValue = Number(item.value) || 0;
                        } else {
                            newValue = String(item.value);
                        }
                        return { ...item, type: newType, value: newValue };
                    }
                    return { ...item, [key]: value };
                })
            };
        });
    };

    // 删除变量
    const handleDraftDeleteVariable = (id: string) => {
        if (!draftProjectState) return;
        setDraftProjectState(prev => prev ? {
            ...prev,
            variables: prev.variables.filter(item => item.id !== id)
        } : null);
    };

    return (
        <div className="settings-section" style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            height: '100%', // 核心：占满右侧内容区的全部高度
            gap: '16px',
            padding: 0, // 清除默认padding，用内部元素精准控制间距
        }}>
            {/* 标题区域 - 固定不滚动 */}
            <h3 style={{ 
                margin: 0, 
                paddingTop: 8,
                paddingBottom: 15,
                borderBottom: `1px solid ${theme === "dark" ? "#444" : "#DDD"}`,
                flexShrink: 0, // 禁止压缩，永久固定在顶部
            }}>
                自定义变量
            </h3>

            {/* 列表表头 - 固定不滚动 */}
            <div 
                className="variable-list-header"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '0 8px 8px 8px',
                    fontSize: '12px',
                    color: 'var(--text)',
                    opacity: 0.6,
                    fontWeight: 600,
                    flexShrink: 0, // 禁止压缩，跟随标题固定
                }}
            >
                <div style={{ width: '50px', textAlign: 'center' }}>持久化</div>
                <div style={{ width: '80px', textAlign: 'center' }}>变量类型</div>
                <div style={{ width: '140px', textAlign: 'center' }}>变量名</div>
                <div style={{ width: '200px', textAlign: 'center' }}>变量值</div>
                <div style={{ width: '85px', textAlign: 'center' }}>操作</div>
            </div>

            {/* 变量列表容器 - 独立滚动区域 */}
            <div 
                className="variable-list custom-scroll"
                style={{
                    flex: 1, // 核心：自动占满剩余全部高度
                    overflowY: 'auto', // 仅此处滚动，表头和按钮不动
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    paddingRight: 4,
                    paddingBottom: 8,
                }}
            >
                {(draftProjectState?.variables || []).length === 0 ? (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '120px',
                        fontSize: '14px',
                        opacity: 0.5,
                        color: 'var(--text)'
                    }}>
                        暂无自定义变量，点击下方按钮添加
                    </div>
                ) : (
                    (draftProjectState?.variables || []).map((variable) => (
                        <VariableRow
                            key={variable.id}
                            variable={variable}
                            theme={theme}
                            onUpdate={handleDraftUpdateVariable}
                            onDelete={handleDraftDeleteVariable}
                        />
                    ))
                )}
            </div>

            {/* 底部添加按钮 - 永久固定在底部，不随列表滚动 */}
            <button
                onClick={handleDraftAddVariable}
                style={{
                    width: '100%',
                    flexShrink: 0, // 禁止压缩，永久固定在底部
                    marginTop: '8px'
                }}
            >
                + 添加自定义变量
            </button>
        </div>
    );
}

const VariableRow = React.memo(({
    variable,
    theme,
    onUpdate,
    onDelete
}: {
    variable: CustomVariable;
    theme: "dark" | "light";
    onUpdate: (id: string, key: keyof CustomVariable, value: any) => void;
    onDelete: (id: string) => void;
}) => {
    // 本地临时状态缓存输入值，仅失焦时同步到父级，避免高频更新
    const [tempName, setTempName] = useState(variable.name);
    const [tempValue, setTempValue] = useState(String(variable.value));

    // 当外部变量数据变化时（如类型切换、重置草稿），同步更新本地状态
    useEffect(() => {
        setTempName(variable.name);
        setTempValue(String(variable.value));
    }, [variable.name, variable.value]);

    // 类型切换处理（保留原有自动转换逻辑）
    const handleTypeChange = (newType: "number" | "string") => {
        onUpdate(variable.id, "type", newType);
    };

    return (
        <div
            className="variable-row"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                border: `1px solid ${theme === "dark" ? "#444" : "#e5e7eb"}`,
                borderRadius: '8px',
                flexShrink: 0,
            }}
        >
            {/* 1. 持久化勾选框 */}
            <div style={{ width: '40px', display: 'flex', justifyContent: 'center' }}>
                <input
                    type="checkbox"
                    checked={variable.persistent}
                    onChange={(e) => onUpdate(variable.id, 'persistent', e.target.checked)}
                    style={{
                        width: '16px',
                        height: '16px',
                        cursor: 'pointer',
                        accentColor: 'var(--accent)'
                    }}
                />
            </div>

            {/* 2. 变量类型下拉框 */}
            <div style={{ width: '90px' }}>
                <select
                    value={variable.type}
                    onChange={(e) => handleTypeChange(e.target.value as "number" | "string")}
                    style={{ width: '100%', margin: 0 }}
                >
                    <option value="number">实数</option>
                    <option value="string">字符串</option>
                </select>
            </div>

            {/* 3. 变量名输入框（同样修复输入卡顿问题） */}
            <div style={{ flex: 1, marginRight: 0 }}>
                <input
                    type="text"
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    onBlur={() => onUpdate(variable.id, 'name', tempName.trim())}
                    placeholder="输入变量名"
                    className="textarea-styled"
                    style={{
                        maxWidth: '120px',
                        padding: '8px 10px',
                    }}
                />
            </div>

            {/* 4. 变量值输入框（核心修复） */}
            <div style={{ flex: 1.6 }}>
                <input
                    type="text"
                    value={tempValue}
                    onChange={(e) => setTempValue(e.target.value)}
                    // 仅失焦时做类型转换+同步到父级，不打断输入
                    onBlur={() => {
                        let finalValue: string | number = tempValue;
                        // 数字类型格式化处理
                        if (variable.type === "number") {
                            const num = Number(tempValue);
                            finalValue = isNaN(num) ? 0 : num;
                            setTempValue(String(finalValue));
                        }
                        onUpdate(variable.id, 'value', finalValue);
                    }}
                    placeholder="输入变量值"
                    className="textarea-styled"
                    style={{
                        maxWidth: '300px',
                        padding: '8px 10px',
                    }}
                />
            </div>

            {/* 5. 删除按钮 */}
            <div style={{ width: '60px', display: 'flex', justifyContent: 'center' }}>
                <button
                    onClick={() => onDelete(variable.id)}
                    style={{
                        padding: '6px 10px',
                        background: '#f04747',
                    }}
                >
                    删除
                </button>
            </div>
        </div>
    );
});

// 仅当当前变量数据变化时才触发重渲染
VariableRow.displayName = "VariableRow";