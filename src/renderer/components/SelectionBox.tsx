import type { SelectionBox as SelectionBoxValue } from "../editorTypes";

type SelectionBoxProps = {
    selectionBox: SelectionBoxValue;
    theme: "dark" | "light";
};

/** 框选时的虚线框 */
export function SelectionBox({ selectionBox, theme }: SelectionBoxProps) {
    if (!selectionBox) return null;

    return (
        <div
            style={{
                position: "fixed",
                left: Math.min(selectionBox.x1, selectionBox.x2),
                top: Math.min(selectionBox.y1, selectionBox.y2),
                width: Math.abs(selectionBox.x2 - selectionBox.x1),
                height: Math.abs(selectionBox.y2 - selectionBox.y1),
                border: "1px solid var(--accent)",
                background: theme === "dark" ? "rgba(114, 137, 218, 0.16)" : "rgba(114, 137, 218, 0.12)",
                boxShadow: "0 0 0 1px rgba(0,0,0,0.06)",
                zIndex: 2500,
                pointerEvents: "none",
            }}
        />
    );
}
