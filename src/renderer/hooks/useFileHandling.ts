import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save, confirm } from "@tauri-apps/plugin-dialog";
import type { EditorState, FileHandle, SelectionBox } from "../editorTypes";
import { makeGml, parseGmlEditorData } from "../editorLogic";
import { ensureGmlName, isTauri } from "../utils/platform";
import type { SelectionDragRef } from "./useViewportInteractions";

type UseFileHandlingParams = {
    state: EditorState;
    setState: Dispatch<SetStateAction<EditorState>>;
    setSelectionBox: Dispatch<SetStateAction<SelectionBox>>;
    setSelectedNodeIds: Dispatch<SetStateAction<number[]>>;
    selectionDragRef: SelectionDragRef;
    setFileMenuOpen: Dispatch<SetStateAction<boolean>>;
    /** 导入/打开成功后关闭正在编辑的节点弹窗 */
    onClearEditing: () => void;
};

/**
 * 文件子系统：文件名/路径/句柄状态、脏标记、打开/保存/另存为/导入，
 * 以及与之绑定的副作用（标题栏、Ctrl+S 快捷键、保存按钮可用态）。
 */
export function useFileHandling({
    state,
    setState,
    setSelectionBox,
    setSelectedNodeIds,
    selectionDragRef,
    setFileMenuOpen,
    onClearEditing,
}: UseFileHandlingParams) {
    const [currentFileName, setCurrentFileName] = useState<string>("新文件");
    const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
    const [currentFileHandle, setCurrentFileHandle] = useState<FileHandle | null>(null);
    const [isDirty, setDirty] = useState(false);
    const suppressDirtyRef = useRef(false);
    const firstStateRef = useRef(true);

    const isNewUntitled = currentFileName === "新文件" && !currentFilePath && !currentFileHandle;
    const hasWorkspaceContent =
        state.nodes.length > 0 || state.comments.length > 0 || state.edges.length > 0;
    const isNewEmpty = isNewUntitled && !hasWorkspaceContent;

    // 编辑器数据变化 → 置脏（新文件且空白时忽略，例如仅平移/缩放）
    useEffect(() => {
        if (firstStateRef.current) {
            firstStateRef.current = false;
            return;
        }
        if (suppressDirtyRef.current) {
            suppressDirtyRef.current = false;
            return;
        }
        if (isNewEmpty) return;
        setDirty(true);
    }, [state.nodes, state.edges, state.comments]);

    // 同步标题栏（浏览器 title + Tauri 原生窗口标题）
    useEffect(() => {
        const titleName = currentFileName || "新文件";
        const fullTitle = `${titleName}${isDirty ? "*" : ""} - 对话编辑器`;
        document.title = fullTitle;
        if (isTauri()) {
            getCurrentWindow().setTitle(fullTitle).catch((err) => {
                console.warn("更新标题栏失败，请检查 Tauri capabilities 是否开启了 set-title 权限:", err);
            });
        }
    }, [currentFileName, isDirty]);

    const handleSaveAs = useCallback(async (): Promise<boolean> => {
        if (!isTauri()) return false;
        const defaultName = ensureGmlName(currentFileName);
        const filePath = await save({ filters: [{ name: "GML Files", extensions: ["gml"] }], defaultPath: defaultName });

        if (!filePath) return false;
        const content = makeGml(state);
        const result = await invoke<{ success: boolean }>("save_file", { path: filePath, content });

        if (result.success) {
            setCurrentFilePath(filePath);
            const fileName = await invoke<string>("get_filename", { path: filePath });
            setCurrentFileName(fileName);
            setDirty(false);
            return true;
        } else {
            alert("保存失败（错误代码：A002）");
            return false;
        }
    }, [currentFileName, state]);

    const handleSave = useCallback(async (): Promise<boolean> => {
        if (!isTauri()) return false;
        const content = makeGml(state);
        // 如果已有文件路径，尝试静默保存
        if (currentFilePath) {
            const result = await invoke<{ success: boolean }>("save_file", { path: currentFilePath, content });
            if (result.success) {
                setDirty(false);
                return true;
            } else {
                // 静默保存失败，回退到另存为
                console.warn("Silent save failed, falling back to Save As.");
                return await handleSaveAs();
            }
        } else {
            return await handleSaveAs();
        }
    }, [currentFilePath, handleSaveAs, state]);

    // Ctrl+S / Cmd+S 保存快捷键
    useEffect(() => {
        const handleSaveShortcut = async (e: KeyboardEvent) => {
            // 匹配保存快捷键，兼容多系统
            const isSaveTrigger = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's';
            if (!isSaveTrigger) return;

            // 阻止浏览器默认的「保存网页」行为
            e.preventDefault();
            e.stopPropagation();

            // 执行保存逻辑
            await handleSave();
        };

        window.addEventListener('keydown', handleSaveShortcut);
        return () => {
            window.removeEventListener('keydown', handleSaveShortcut);
        };
    }, [handleSave]);

    // 修复另存为按钮状态问题
    useEffect(() => {
        const saveAsButton = document.getElementById("saveAsButton") as HTMLButtonElement | null;
        if (saveAsButton) {
            saveAsButton.disabled = !isDirty && !currentFilePath;
        }
        return undefined; // 确保返回 void 类型
    }, [isDirty, currentFilePath]);

    const onImport = (file: File) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target?.result as string;
            const parsed = parseGmlEditorData(text);
            if (!parsed) {
                alert("此文件不含编辑器元数据！");
                return;
            }
            suppressDirtyRef.current = true;
            selectionDragRef.current = null;
            setSelectionBox(null);
            setSelectedNodeIds([]);
            setState(parsed);
            onClearEditing();
            setDirty(false);
            const anyFile = file as any;
            const path = typeof anyFile.path === "string" ? anyFile.path : null;
            setCurrentFileName(file.name || "新文件");
            setCurrentFilePath(path);
            setCurrentFileHandle(null);
        };
        reader.readAsText(file);
    };

    const handleOpenClick = async () => {
        setFileMenuOpen(false);

        // 如果当前已修改，先提示保存
        if (isDirty) {
            const res = isTauri()
                ? await confirm("当前文件尚未保存，是否先保存更改？", { title: "未保存", kind: "warning" })
                : window.confirm("当前文件尚未保存，是否先保存更改？");
            if (res) {
                const saved = await handleSave();
                if (!saved) return; // 用户取消了保存或保存失败，停止打开流程
            }
        }

        if (!isTauri()) return;
        const filePath = await open({ filters: [{ name: "GML Files", extensions: ["gml"] }], multiple: false });
        if (!filePath) return;

        const content = await invoke<string>("read_file", { path: filePath });
        if (content) {
            const parsed = parseGmlEditorData(content);
            if (parsed) {
                suppressDirtyRef.current = true;
                selectionDragRef.current = null;
                setSelectionBox(null);
                setSelectedNodeIds([]);
                setState(parsed);
                setCurrentFilePath(filePath);
                setCurrentFileName(await invoke<string>("get_filename", { path: filePath }));
                setDirty(false);
            } else {
                alert("无法解析该文件。");
            }
        }
    };

    return {
        currentFileName,
        currentFilePath,
        isDirty,
        setDirty,
        isNewEmpty,
        handleOpenClick,
        handleSave,
        handleSaveAs,
        onImport,
        suppressDirtyRef,
    };
}
