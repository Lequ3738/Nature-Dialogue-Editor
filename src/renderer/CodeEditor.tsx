import React, { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import {
    Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import {
    HighlightStyle, syntaxHighlighting, syntaxTree, indentUnit
} from "@codemirror/language";
import {
    autocompletion, type CompletionContext
} from "@codemirror/autocomplete";
import { createGmlLanguage, gmlKeywordList, gmlBuiltinList } from "./gmlLanguage";
import { tags as t } from "@lezer/highlight";
import { Character, charaMotionAndExpressionInfo } from "./editorTypes";

export type KeywordType = "function" | "variable" | "keyword" | "constant";

export type KeywordGroup = {
    id: string;
    name: string;        // 分组名，如 "内置函数", "自定义宏"
    type: KeywordType;   // 类型，如 "function", "macro"，可用于补全时的图标区分
    colorLight: string;  // 浅色模式颜色
    colorDark: string;   // 深色模式颜色
    keywords: string[];  // 具体的关键字列表
};

export type CodeStyleProfile = {
    name: string;
    fontFamily: string;
    fontSize: number;

    characterColorLight: string;
    characterColorDark: string;
    characters: Character[];

    keywordGroups: KeywordGroup[]; 
};

export interface CodeEditorProps {
    value: string;
    onChange: (val: string) => void;
    theme?: "light" | "dark";
    profile: CodeStyleProfile;
    height?: number;
}

export default function CodeEditor(
    { value, onChange, theme = "dark", profile, height = 300 }: 
    CodeEditorProps
) {
    const [extensionsKey, setExtensionsKey] = useState(0);

    useEffect(() => {
        setExtensionsKey((k) => k + 1);
    }, [profile]);

    const rulesMap = useMemo(() => {
        const map = new Map<string, string>();
        
        // 核心优先级逻辑：
        // 1. 遍历分组。如果不同分组有相同关键字，后面的分组会 set 覆盖前面的，
        //    因此最终 map 中保留的是“下面分组”的颜色。
        // 2. 在着色插件中，我们会优先检查此 Map，从而覆盖内置 GML 颜色。
        profile.keywordGroups.forEach(group => {
            const color = theme === "light" ? group.colorLight : group.colorDark;
            group.keywords.forEach(kw => {
                const trimmed = kw.trim();
                if (trimmed) map.set(trimmed, color);
            });
        });

        profile.characters.forEach(char => {
            const color = theme === "light" ? 
                profile.characterColorLight : profile.characterColorDark;
            const trimmed = char.constantName.trim();
            if (trimmed) map.set(trimmed, color);
        });

        return map;
    }, [profile.keywordGroups, profile.characters, theme]);

    // 高亮插件逻辑
    const highlightPlugin = useMemo(() => ViewPlugin.fromClass(class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = this.buildDecorations(view);
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged) {
                this.decorations = this.buildDecorations(update.view);
            }
        }

        buildDecorations(view: EditorView) {
            const builder = new RangeSetBuilder<Decoration>();
            
            for (let { from, to } of view.visibleRanges) {
                syntaxTree(view.state).iterate({
                    from, to,
                    enter: (node) => {
                        // 只拦截我们关心的词法节点类型
                        const isWordNode = 
                            node.name === "keyword" || 
                            node.name === "variable" || 
                            node.name === "constant" || 
                            node.name === "function";
                            
                        if (isWordNode) {
                            const text = view.state.sliceDoc(node.from, node.to);
                            const color = rulesMap.get(text);
                            
                            if (color) {
                                builder.add(
                                    node.from, node.to,
                                    Decoration.mark({
                                        attributes: { style: 
                                            `color: ${color} !important; ${
                                            node.name === "keyword" ? 
                                            "font-weight: bold;" : ""
                                        }` }
                                    })
                                );
                            }
                        }
                    }
                });
            }
            return builder.finish();
        }
    }, {
        decorations: v => v.decorations
    }) , [rulesMap]);

    const createEditorHighlightStyle = (theme: "light" | "dark") => {
        const isDark = theme === "dark";
        
        return HighlightStyle.define([
            { tag: t.keyword, color: isDark ? "#569CD6" : "#000080", fontWeight: "bold" },
            { tag: t.string, color: isDark ? "#92CAF4" : "#0000FF" },
            { tag: t.number, color: isDark ? "#B8D7A3" : "#0000FF" },
            { tag: t.comment, color: isDark ? "#57A64A" : "#008000" },
            { tag: t.operator, color: isDark ? "#C8C8C8" : "#606060" },
            { tag: t.brace, color: isDark ? "#569CD6" : "#000080", fontWeight: "bold" },
        ]);
    };

    // --- 3. 代码补全生成器 ---
    const customAutocomplete = useMemo(() => {
        return autocompletion({
            override: [(context: CompletionContext) => {
                // 在字符串/注释内部，不提供任何补全选项
                const nodeBefore = syntaxTree(context.state).resolveInner(context.pos, -1);
                if (nodeBefore.name === "string" || nodeBefore.name === "blockComment" || 
                    nodeBefore.name === "lineComment") {
                    return null;
                }

                const word = context.matchBefore(/\w*/);
                if (!word || (word.from === word.to && !context.explicit)) return null;

                const options: any[] = [];
                const addedLabels = new Set<string>(); // 用于去重记录

                // 1. 添加内置关键字和常量
                gmlKeywordList.forEach(k => {
                    options.push({ label: k, type: "keyword", boost: 1 });
                    addedLabels.add(k);
                });
                gmlBuiltinList.forEach(b => {
                    options.push({ label: b, type: "constant" });
                    addedLabels.add(b);
                });

                // 2. 添加用户自定义配置中的关键字
                profile.keywordGroups.forEach(group => {
                    group.keywords.forEach(key => {
                        const trimmedKey = key.trim();
                        if (trimmedKey) {
                            const hasDescription = charaMotionAndExpressionInfo.has(trimmedKey);

                            options.push({
                                label: trimmedKey,
                                type: group.type || "variable",
                                info: `[${group.name}${
                                    hasDescription ? ` - ${
                                    charaMotionAndExpressionInfo.get(trimmedKey)
                                    }` : ""}]`,
                                boost: 2
                            });
                            addedLabels.add(trimmedKey);
                        }
                    });
                });

                profile.characters.forEach(char => {
                    const trimmedKey = char.constantName.trim();
                    if (trimmedKey && !addedLabels.has(trimmedKey)) {
                        options.push({
                            label: trimmedKey,
                            type: "constant",
                            info: `[角色：${char.name}]`,
                            boost: 2
                        });
                        addedLabels.add(trimmedKey);
                    }
                });

                // 从当前文档的语法树中提取“上下文变量”
                syntaxTree(context.state).iterate({
                    enter: (node) => {
                        // 只提取被判定为“变量名”的节点
                        if (node.name === "variable") {
                            if (node.from <= context.pos && node.to >= context.pos) {
                                return;
                            }

                            const text = context.state.sliceDoc(node.from, node.to);
                            // 过滤掉已经加到列表里的内置函数或自定义关键字
                            if (!addedLabels.has(text)) {
                                addedLabels.add(text);
                                options.push({
                                    label: text,
                                    type: "variable",
                                    info: "(自定义变量)",
                                    boost: 0 // 优先级最低，排在关键字下面
                                });
                            }
                        }
                    }
                });

                return {
                    from: word.from,
                    options: options,
                    filter: true
                };
            }]
        });
    }, [profile.keywordGroups, profile.characters]);

    const themeExt = useMemo(() => EditorView.theme({
        // 编辑器根容器
        "&": {
            fontSize: `${profile.fontSize}px`,
            height: `${height}px`,
        },
        // 滚动区域（决定了整个编辑框的背景色）
        ".cm-scroller": {
            fontFamily: profile.fontFamily, // 响应字体设置
            backgroundColor: theme === "light" ? "#ffffff" : "#1E2024", // 响应背景色
        },
        // 内容区域（决定了代码文字的字体和颜色）
        ".cm-content": {
            fontFamily: profile.fontFamily,
            color: theme === "light" ? "#0f172a" : "#e5e7eb",
            caretColor: theme === "light" ? "#0f172a" : "#e5e7eb",
        },
        // 左侧行号区域
        ".cm-gutters": {
            fontFamily: profile.fontFamily,
            backgroundColor: theme === "light" ? "#f8fafc" : "rgba(255,255,255,0.04)",
            color: theme === "light" ? "#94a3b8" : "#6b7280",
            borderRight: "1px solid rgba(127, 127, 127, 0.25)",
        },
        ".cm-gutterElement.cm-activeLineGutter": {
            backgroundColor: theme === "light" ? "#e2e8f0" : "rgba(255, 255, 255, 0.08)",
            color: theme === "light" ? "#0f172a" : "#ffffff",
        },
        ".cm-activeLine": {
            backgroundColor: (theme === "light" ? "#3D597A20" : "#3D597A30") + " !important",
        },
        // 选中状态的背景色
        ".cm-selectionBackground": {
            backgroundColor: (theme === "light" ? "#ADD6FF" : "#264F78") + " !important",
        },

        ".cm-tooltip": {
            backgroundColor: theme === "light" ? "#ffffff" : "#2d3139",
            border: theme === "light" ? "1px solid #ddd" : "1px solid #181a1f",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
            fontFamily: profile.fontFamily,
            fontSize: `${profile.fontSize - 1}px`,
        },

        ".cm-tooltip-autocomplete": {
            "& > ul": {
                fontFamily: profile.fontFamily,
            },
            "& > ul > li": {
                padding: "4px 8px",
                borderRadius: "8px",
                lineHeight: "1.5",
            },
            // 鼠标悬停或键盘选中的项
            "& > ul > li[aria-selected]": {
                backgroundColor: theme === "light" ? "#e2e8f0" : "#3e4451",
                color: theme === "light" ? "#000" : "#fff",
            }
        },

        ".cm-completionMatchedText": {
            textDecoration: "none",
            fontWeight: "bold",
            color: theme === "light" ? "#2563eb" : "#61afef",
        },

        ".cm-cursor": {
            borderLeft: "2px solid " + (theme === "light" ? "#222" : "#DDD"),
        },
    }), [profile.fontFamily, profile.fontSize, theme, height]);

    const overrideWords = useMemo(() => {
        const set = new Set<string>();
    
        profile.keywordGroups.forEach(group => {
            group.keywords.forEach(k => {
                const word = k.trim();
                if (word) set.add(word);
            });
        });

        profile.characters.forEach(char => {
            const word = char.constantName.trim();
            if (word) set.add(word);
        });
    
        return set;
    }, [profile.keywordGroups]);

    const gml = useMemo(() => createGmlLanguage(overrideWords), [overrideWords]);

    const extensions = useMemo(
        () => [
            gml, themeExt, indentUnit.of("    "), 
            syntaxHighlighting(createEditorHighlightStyle(theme)), 
            highlightPlugin, customAutocomplete
        ],
        [gml, themeExt, highlightPlugin, customAutocomplete, theme]
    );

    return (
        <div style={{
            borderRadius: 8, overflow: "hidden", 
            border: theme === "light" ? "1px solid #ddd" : "1px solid #444"
        }}>
            <CodeMirror
                key={extensionsKey}
                value={value}
                height={`${height}px`}
                basicSetup={{ lineNumbers: true, foldGutter: true, dropCursor: false }}
                extensions={extensions}
                onChange={onChange}
            />
        </div>
    );
}