/** 运行环境判定与文件名工具 */

/** 是否运行在 Tauri 外壳中（而非纯浏览器） */
export function isTauri(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 文件选择被用户取消时，DOMException 的常见形态 */
export function isFilePickerCancelled(err: unknown): boolean {
    const e = err as any;
    const name = typeof e?.name === "string" ? e.name : "";
    // File System Access API: user cancel is usually AbortError
    if (name === "AbortError" || name === "NotAllowedError") return true;
    // Sometimes DOMException uses a numeric code.
    if (typeof e?.code === "number" && e.code === 20) return true;
    return false;
}

/** 确保导出/保存的文件名以 .gml 结尾 */
export function ensureGmlName(name: string): string {
    const trimmed = (name || "").trim();
    if (!trimmed) return "dialog_system.gml";
    return trimmed.toLowerCase().endsWith(".gml") ? trimmed : `${trimmed}.gml`;
}
