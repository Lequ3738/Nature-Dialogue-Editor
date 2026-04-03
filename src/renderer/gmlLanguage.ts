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

const normalize = (s: string) => s.trim().toLowerCase();

export function createGmlLanguage(overrideWords: Set<string> = new Set()) {
    function tokenBase(stream: StringStream, state: any): string | null {
        if (stream.eatSpace()) return null;

        if (stream.match("//")) {
            stream.skipToEnd();
            return "lineComment";
        }

        if (stream.match("/*")) {
            state.tokenize = tokenComment;
            return tokenComment(stream, state);
        }

        if (stream.match('"', false) || stream.match("'", false)) {
            state.tokenize = tokenString(stream.peek()!);
            return state.tokenize(stream, state);
        }

        if (stream.match(/^\$[0-9a-fA-F]+/)) return "number";
        if (stream.match(/^[0-9]+(\.[0-9]+)?/)) return "number";

        if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
            const word = stream.current();
            const key = normalize(word);

            // 先看规则表：命中后，不再走 keyword / builtin 分类
            if (overrideWords.has(key)) return "customKeyword";

            if (gmlKeywords.test(word)) return "keyword";
            if (gmlBuiltins.test(word)) return "bool";

            if (stream.peek() === "(") return "function";

            return "variableName";
        }

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

    return StreamLanguage.define({
        startState: () => ({ tokenize: tokenBase }),
        token: (stream, state) => state.tokenize(stream, state),
        languageData: {
            commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
        },
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
            customKeyword: t.macroName
        },
    });
}