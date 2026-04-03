import React, { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { autocompletion, completeAnyWord, type CompletionContext } from "@codemirror/autocomplete";
import { gml } from "./gmlLanguage";
import { gmlKeywordList, gmlBuiltinList } from "./gmlLanguage";

// --- 1. 重新定义数据结构 (类似 Notepad++ 的分类) ---
export type KeywordGroup = {
    id: string;
    name: string;        // 分组名，如 "内置函数", "自定义宏"
    colorLight: string;  // 浅色模式颜色
    colorDark: string;   // 深色模式颜色
    keywords: string[];  // 具体的关键字列表
};

export type CodeStyleProfile = {
    name: string;
    fontFamily: string;
    fontSize: number;
    keywordGroups: KeywordGroup[]; 
};

interface CodeEditorProps {
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
                if (trimmed) {
                    map.set(trimmed, color);
                }
            });
        });
        return map;
    }, [profile.keywordGroups, theme]);

    // 高亮插件逻辑
    const highlightPlugin = useMemo(() => ViewPlugin.fromClass(class {
        decorations: DecorationSet;
        constructor(view: EditorView) { this.decorations = this.getDeco(view); }
        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged) {
                this.decorations = this.getDeco(update.view);
            }
        }
        getDeco(view: EditorView) {
            const builder = new RangeSetBuilder<Decoration>();
            for (let { from, to } of view.visibleRanges) {
                syntaxTree(view.state).iterate({
                    from, to,
                    enter: (node) => {
                        if (node.name === "Document" || node.name === "LineComment" || node.name === "BlockComment" || node.name === "String") {
                            return;
                        }
                        const word = view.state.doc.sliceString(node.from, node.to);
                        const customColor = rulesMap.get(word);
                        if (customColor) {
                            builder.add(node.from, node.to, Decoration.mark({
                                // 必须加 !important，这样才能覆盖掉 CodeMirror 自带的主题和内置关键字的 CSS 类着色
                                attributes: { style: `color: ${customColor} !important; font-weight: bold;` }
                            }));
                        }
                    }
                });
            }
            return builder.finish();
        }
    }, { decorations: v => v.decorations }), [rulesMap]);

    // --- 3. 代码补全生成器 ---
    const customAutocomplete = useMemo(() => {
        function gmlCompletions(context: CompletionContext) {
            // 匹配正在输入的词
            let word = context.matchBefore(/\w*/);
            if (!word || (word.from === word.to && !context.explicit)) return null;

            const options: any[] = [];

            // 1. 添加 GM8 默认关键字
            gmlKeywordList.forEach(k => options.push({ label: k, type: "keyword" }));
            gmlBuiltinList.forEach(k => options.push({ label: k, type: "variable" }));

            // 2. 添加用户自定义关键字
            profile.keywordGroups.forEach(group => {
                group.keywords.forEach(k => {
                    if (k.trim()) {
                        options.push({ label: k.trim(), type: "function", info: `[${group.name}]` });
                    }
                });
            });

            return {
                from: word.from,
                options: options,
                validFor: /^\w*$/
            };
        }

        // 使用自定义补全 + 当前文档上下文补全 (completeAnyWord)
        return autocompletion({ override: [gmlCompletions, completeAnyWord] });
    }, [profile]);

    const themeExt = useMemo(() => EditorView.theme({
        // 1. 编辑器根容器
        "&": {
            fontSize: `${profile.fontSize}px`,
            height: `${height}px`,
        },
        // 2. 关键：滚动区域（决定了整个编辑框的背景色）
        ".cm-scroller": {
            fontFamily: profile.fontFamily, // 响应字体设置
            backgroundColor: theme === "light" ? "#ffffff" : "#1E2024", // 响应背景色
        },
        // 3. 关键：内容区域（决定了代码文字的字体和颜色）
        ".cm-content": {
            fontFamily: profile.fontFamily,
            color: theme === "light" ? "#0f172a" : "#e5e7eb",
            caretColor: theme === "light" ? "#0f172a" : "#e5e7eb",
        },
        // 4. 左侧行号区域
        ".cm-gutters": {
            fontFamily: profile.fontFamily,
            backgroundColor: theme === "light" ? "#f8fafc" : "rgba(255,255,255,0.04)",
            color: theme === "light" ? "#94a3b8" : "#6b7280",
            borderRight: "1px solid rgba(127, 127, 127, 0.25)",
        },
        // 选中状态的背景色（可选，让深色模式更好看）
        ".cm-selectionBackground": {
            backgroundColor: theme === "light" ? "#e2e8f0" : "#374151 !important",
        }
    }), [profile.fontFamily, profile.fontSize, theme, height]);

    const extensions = useMemo(
        () => [gml, themeExt, highlightPlugin, customAutocomplete],
        [gml, themeExt, highlightPlugin, customAutocomplete]
    );

    return (
        <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid #333" }}>
            <CodeMirror
                key={extensionsKey}
                value={value}
                height={`${height}px`}
                basicSetup={{ lineNumbers: true, foldGutter: false, dropCursor: false }}
                extensions={extensions}
                onChange={onChange}
            />
        </div>
    );
}