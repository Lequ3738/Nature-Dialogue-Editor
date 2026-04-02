import { StreamLanguage, StringStream } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// 关键字
export const gmlKeywordList = [
    "mod", "div", "if", "else", "switch", "default", "repeat", 
    "while", "for", "do", "until", "with", "continue", "break", 
    "exit", "return", "case", "and", "or", "xor", "not", "self", 
    "other", "all", "noone", "global", "local", "var", "globalvar",
    "then", "begin", "end"
];

// 常量
export const gmlBuiltinList = [
    "true", "false", "pi"
];

const gmlKeywords = new RegExp(`^(${gmlKeywordList.join('|')})$`);
const gmlBuiltins = new RegExp(`^(${gmlBuiltinList.join('|')})$`);

function tokenBase(stream: StringStream, state: any): string | null {
    if (stream.eatSpace()) return null;

    // 单行注释
    if (stream.match("//")) {
        stream.skipToEnd();
        return "lineComment";
    }
    
    // 多行注释
    if (stream.match("/*")) {
        state.tokenize = tokenComment;
        return tokenComment(stream, state);
    }

    // 字符串 (GM8 支持双引号和单引号)
    if (stream.match('"', false) || stream.match("'", false)) {
        state.tokenize = tokenString(stream.peek()!);
        return state.tokenize(stream, state);
    }

    // 16进制数字 (GM8 使用 $ 作为前缀，如 $FFFFFF)
    if (stream.match(/^\$[0-9a-fA-F]+/)) return "number";
    // 10进制数字
    if (stream.match(/^[0-9]+(\.[0-9]+)?/)) return "number";

    // 标识符 (变量名, 关键字, 函数)
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
        const word = stream.current();
        if (gmlKeywords.test(word)) return "keyword";
        if (gmlBuiltins.test(word)) return "bool"; // 用 bool 颜色映射常量

        // 如果紧跟左括号，说明是函数调用
        if (stream.peek() === "(") return "function";
        
        return "variableName";
    }

    // 操作符与符号
    if (stream.match(/^[+\-*\/=<>!&|~^%:]+/)) return "operator";
    if (stream.match(/^[()[\]{}]/)) return "punctuation";

    stream.next();
    return null;
}

function tokenComment(stream: StringStream, state: any): string {
    let maybeEnd = false;
    let ch;
    while ((ch = stream.next())) {
        if (ch === "/" && maybeEnd) {
            state.tokenize = tokenBase;
            break;
        }
        maybeEnd = ch === "*";
    }
    return "blockComment";
}

function tokenString(quote: string) {
    return function (stream: StringStream, state: any): string {
        let escaped = false;
        let ch;
        while ((ch = stream.next()) != null) {
            if (ch === quote && !escaped) {
                state.tokenize = tokenBase;
                break;
            }
            escaped = !escaped && ch === "\\";
        }
        return "string";
    };
}

export const gml = StreamLanguage.define({
    startState: () => ({ tokenize: tokenBase }),
    token: (stream, state) => state.tokenize(stream, state),
    languageData: {
        commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
    },
    // 将解析出的 token 映射到 CodeMirror 6 的标准高亮 Tag 上
    tokenTable: {
        lineComment: t.lineComment,
        blockComment: t.blockComment,
        string: t.string,
        number: t.number,
        keyword: t.keyword,
        bool: t.bool,
        operator: t.operator,
        function: t.function(t.variableName),
        variableName: t.variableName,
        punctuation: t.punctuation,
    },
});