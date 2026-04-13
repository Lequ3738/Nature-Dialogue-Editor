import React, { useMemo, useRef, useCallback, useLayoutEffect, useState } from "react";

interface HighlightTextareaProps {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    highlight?: string;
    highlightStyle?: React.CSSProperties;
    rows?: number;
    className?: string;
    style?: React.CSSProperties;
    placeholder?: string;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    [key: string]: any;
}

const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default function HighlightTextarea({
    value,
    onChange,
    highlight = "",
    highlightStyle = { backgroundColor: "#fde047", borderRadius: "2px" },
    rows,
    className,
    style,
    placeholder,
    caseSensitive = false,
    wholeWord = false,
    ...restProps
}: HighlightTextareaProps) {
    const backgroundRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const [backgroundWidth, setBackgroundWidth] = useState<number>(0);

    const syncLayout = useCallback(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        setBackgroundWidth(textarea.clientWidth);
    }, []);

    useLayoutEffect(() => {
        syncLayout();

        const textarea = textareaRef.current;
        if (!textarea || typeof ResizeObserver === "undefined") return;

        const ro = new ResizeObserver(() => {
            syncLayout();
        });

        ro.observe(textarea);
        return () => ro.disconnect();
    }, [syncLayout, value, highlight, caseSensitive, wholeWord, style]);

    const syncScroll = useCallback(() => {
        const textarea = textareaRef.current;
        const background = backgroundRef.current;
        if (!textarea || !background) return;
        background.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
    }, []);

    const handleScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
        syncScroll();
    }, [syncScroll]);

    useLayoutEffect(() => {
        syncScroll();
    }, [value, highlight, caseSensitive, wholeWord, syncScroll]);

    const highlightedHTML = useMemo(() => {
        if (!highlight.trim()) {
            return value.replace(/\n/g, "<br/>");
        }

        const escapedHighlight = escapeRegExp(highlight);
        const pattern = wholeWord ? `\\b${escapedHighlight}\\b` : escapedHighlight;
        const flags = caseSensitive ? "g" : "gi";
        const regex = new RegExp(`(${pattern})`, flags);

        const parts = value.split(regex);
        return parts.map((part) => {
            let isMatch = false;
            if (part) {
                if (wholeWord && caseSensitive) isMatch = part === highlight;
                else if (wholeWord) isMatch = part.toLowerCase() === highlight.toLowerCase();
                else if (caseSensitive) isMatch = part === highlight;
                else isMatch = part.toLowerCase() === highlight.toLowerCase();
            }

            if (isMatch) {
                const styleStr = Object.entries(highlightStyle)
                    .map(([key, val]) => `${key.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}:${val}`)
                    .join(";");
                return `<span style="${styleStr}">${part.replace(/\n/g, "<br/>")}</span>`;
            }
            return part.replace(/\n/g, "<br/>");
        }).join("");
    }, [value, highlight, caseSensitive, wholeWord, highlightStyle]);

    const baseTextStyle: React.CSSProperties = {
        boxSizing: "border-box",
        padding: "10px",
        margin: 0,
        fontFamily: 'Consolas, 微软雅黑, monospace',
        fontSize: "14px",
        lineHeight: "1.4",
        whiteSpace: "pre-wrap",
        wordWrap: "break-word",
        overflowWrap: "break-word",
    };

    const containerStyle: React.CSSProperties = {
        position: "relative",
        width: "100%",
        height: "fit-content",
        boxSizing: "border-box",
    };

    const backgroundStyle: React.CSSProperties = {
        ...baseTextStyle,
        position: "absolute",
        top: 0,
        left: 0,
        width: backgroundWidth ? `${backgroundWidth}px` : "100%",
        pointerEvents: "none",
        zIndex: 1,
        color: "transparent",
        transform: "translate(0px, 0px)",
    };

    const textareaStyle: React.CSSProperties = {
        ...baseTextStyle,
        ...style,
        position: "relative",
        width: "100%",
        minHeight: "92px",
        overflowY: "auto",
        overflowX: "hidden",
        background: "transparent",
        color: "inherit",
        zIndex: 2,
        caretColor: "currentColor",
        resize: style?.resize || "vertical",
    };
    
    return (
        <div style={containerStyle} className={className}>
            <div
                ref={backgroundRef}
                style={backgroundStyle}
                dangerouslySetInnerHTML={{ __html: highlightedHTML }}
            />
            <textarea
                ref={textareaRef}
                value={value}
                onChange={onChange}
                onScroll={handleScroll}
                rows={rows}
                style={textareaStyle}
                placeholder={placeholder}
                {...restProps}
            />
        </div>
    );
}