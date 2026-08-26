import type { Character } from "./editorTypes";

/** 代码配色配置类型。独立成纯类型模块，供 editorTypes 与 Node 环境（MCP server）复用，
 *  避免引入 CodeEditor 组件的 React/CodeMirror 运行时依赖。 */

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
