import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save, confirm } from "@tauri-apps/plugin-dialog";
import { watch } from "@tauri-apps/plugin-fs";
import type { EditorState, FileHandle, SelectionBox } from "../editorTypes";
import { fitViewToNodes, makeGml, parseGmlEditorData } from "../editorLogic";
import { deserializeProject, serializeProject } from "../projectFile";
import { ensureGmlName, ensureProjectName, isTauri, stripKnownExtension } from "../utils/platform";
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
    /** 视野自适应需要视口尺寸 */
    windowSize: { w: number; h: number };
};

/** 拆分路径为目录与文件名（兼容反斜杠与正斜杠） */
function splitPath(p: string): { dir: string; name: string } {
    const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
    return i >= 0 ? { dir: p.slice(0, i), name: p.slice(i + 1) } : { dir: "", name: p };
}

function joinPath(dir: string, name: string): string {
    if (!dir) return name;
    return dir.endsWith("\\") || dir.endsWith("/") ? dir + name : dir + "\\" + name;
}

/**
 * 文件子系统：工程文件(.dialogue.json)的打开/保存/另存为、旧版 .gml 工程导入迁移、
 * 导出 GML 产物，以及脏标记、标题栏、Ctrl+S 等绑定副作用。
 *
 * 工程文件是唯一权威数据源；.gml 是随时可重新生成的导出产物，不承载工程数据。
 */
export function useFileHandling({
    state,
    setState,
    setSelectionBox,
    setSelectedNodeIds,
    selectionDragRef,
    setFileMenuOpen,
    onClearEditing,
    windowSize,
}: UseFileHandlingParams) {
    const [currentFileName, setCurrentFileName] = useState<string>("新文件");
    const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
    const [currentFileHandle, setCurrentFileHandle] = useState<FileHandle | null>(null);
    const [isDirty, setDirty] = useState(false);
    // 当前内容来自旧版 .gml 工程时为 true：保存强制走"另存为"，避免把 JSON 写回 .gml 路径
    const [isLegacyProject, setIsLegacyProject] = useState(false);
    const suppressDirtyRef = useRef(false);
    const firstStateRef = useRef(true);
    // 上一次导出 GML 的位置，作为下次导出的默认值
    const lastGmlPathRef = useRef<string | null>(null);

    // ---- 外部修改（冲突）检测 ----
    const currentFilePathRef = useRef<string | null>(null);
    useEffect(() => {
        currentFilePathRef.current = currentFilePath;
    }, [currentFilePath]);
    // 我们自己写盘的时间戳：短窗口内忽略监听事件，防止自触发
    const lastSelfWriteRef = useRef(0);
    // 当前激活的 watch 注销函数
    const unwatchRef = useRef<(() => void) | null>(null);
    // 外部修改处理中（弹窗打开期间忽略后续事件）
    const handlingExternalRef = useRef(false);
    // 总是引用最新的外部修改处理器
    const handleExternalChangeRef = useRef<() => Promise<void>>(async () => {});

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

    /** 保存成功返回写入路径，失败/取消返回 null */
    const handleSaveAs = useCallback(async (): Promise<string | null> => {
        if (!isTauri()) return null;
        // 默认路径：沿用当前工程目录与文件名（补全 .dialogue.json 扩展名）
        let defaultPath = ensureProjectName(currentFileName);
        if (currentFilePath) {
            const { dir, name } = splitPath(currentFilePath);
            defaultPath = joinPath(dir, ensureProjectName(name));
        }
        const filePath = await save({
            filters: [{ name: "对话工程文件", extensions: ["json"] }],
            defaultPath,
        });

        if (!filePath) return null;
        const content = serializeProject(state);
        lastSelfWriteRef.current = Date.now();
        const result = await invoke<{ success: boolean }>("save_file", { path: filePath, content });

        if (result.success) {
            setCurrentFilePath(filePath);
            const fileName = await invoke<string>("get_filename", { path: filePath });
            setCurrentFileName(fileName);
            setIsLegacyProject(false);
            setDirty(false);
            return filePath;
        } else {
            alert("保存失败（错误代码：A002）");
            return null;
        }
    }, [currentFileName, currentFilePath, state]);

    /** 保存成功返回写入路径，失败/取消返回 null */
    const handleSave = useCallback(async (): Promise<string | null> => {
        if (!isTauri()) return null;
        // 旧版工程迁移而来时禁止静默覆盖原 .gml，引导另存为新格式
        if (!currentFilePath || isLegacyProject) {
            return await handleSaveAs();
        }
        const content = serializeProject(state);
        lastSelfWriteRef.current = Date.now();
        const result = await invoke<{ success: boolean }>("save_file", { path: currentFilePath, content });
        if (result.success) {
            setDirty(false);
            return currentFilePath;
        } else {
            // 静默保存失败，回退到另存为
            console.warn("Silent save failed, falling back to Save As.");
            return await handleSaveAs();
        }
    }, [currentFilePath, isLegacyProject, handleSaveAs, state]);

    /** 导出 GML：由工程文件生成引擎用的 .gml 产物 */
    const handleExportGml = useCallback(async (): Promise<boolean> => {
        if (!isTauri()) return false;
        // 默认导出到上次位置；否则放在工程文件旁，同名替换扩展名
        let defaultPath = lastGmlPathRef.current ?? ensureGmlName(currentFileName);
        if (!lastGmlPathRef.current && currentFilePath) {
            const { dir, name } = splitPath(currentFilePath);
            defaultPath = joinPath(dir, ensureGmlName(stripKnownExtension(name)));
        }
        const filePath = await save({
            filters: [{ name: "GML Files", extensions: ["gml"] }],
            defaultPath,
        });
        if (!filePath) return false;

        const result = await invoke<{ success: boolean }>("save_file", { path: filePath, content: makeGml(state) });
        if (result.success) {
            lastGmlPathRef.current = filePath;
            return true;
        }
        alert("导出失败（错误代码：A003）");
        return false;
    }, [currentFileName, currentFilePath, state]);

    /** 一键保存并导出：写工程文件 + 写 GML 产物 */
    const handleSaveAndExport = useCallback(async (): Promise<boolean> => {
        const savedPath = await handleSave();
        if (!savedPath) return false;

        // 导出目标：优先上次导出位置（静默写入）；
        // 没有历史位置时弹一次对话框让用户确认，此后记住位置全程无弹窗
        if (lastGmlPathRef.current) {
            const result = await invoke<{ success: boolean }>("save_file", {
                path: lastGmlPathRef.current,
                content: makeGml(state),
            });
            if (result.success) return true;
            alert("导出失败（错误代码：A003），请尝试手动「导出 GML」");
            return false;
        }
        return await handleExportGml();
    }, [handleSave, handleExportGml, state]);

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

    // 关闭拦截：有未保存修改时先询问（右上角 X、Alt+F4、系统菜单关闭均生效）
    const isDirtyRef = useRef(false);
    useEffect(() => {
        isDirtyRef.current = isDirty;
    }, [isDirty]);
    const handleSaveRef = useRef(handleSave);
    useEffect(() => {
        handleSaveRef.current = handleSave;
    }, [handleSave]);

    useEffect(() => {
        if (!isTauri()) {
            // 纯浏览器模式：beforeunload 兜底
            const handler = (e: BeforeUnloadEvent) => {
                if (!isDirtyRef.current) return;
                e.preventDefault();
                e.returnValue = "";
            };
            window.addEventListener("beforeunload", handler);
            return () => window.removeEventListener("beforeunload", handler);
        }

        let cancelled = false;
        let unlisten: (() => void) | null = null;
        getCurrentWindow().onCloseRequested(async (event) => {
            if (!isDirtyRef.current) return;
            event.preventDefault(); // 先拦下，由确认流程决定是否真关
            const res = await confirm("当前文件尚未保存，是否保存更改？", { title: "未保存", kind: "warning" });
            if (res) {
                const saved = await handleSaveRef.current();
                if (!saved) return; // 保存失败或用户取消了另存为 → 留在编辑器
            }
            // 用户选择不保存，或已保存成功：真正关闭。
            // destroy() 不再触发 CloseRequested（避免递归），需要 core:window:allow-destroy 权限
            await getCurrentWindow().destroy();
        }).then((fn) => {
            if (cancelled) fn();
            else unlisten = fn;
        });
        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, []);

    // 修复另存为按钮状态问题
    useEffect(() => {
        const saveAsButton = document.getElementById("saveAsButton") as HTMLButtonElement | null;
        if (saveAsButton) {
            saveAsButton.disabled = !isDirty && !currentFilePath;
        }
        return undefined; // 确保返回 void 类型
    }, [isDirty, currentFilePath]);

    /** 打开成功后的公共收尾：写入状态 + 视野自适应 */
    const applyLoadedProject = (
        parsed: EditorState,
        fileName: string,
        filePath: string | null,
        legacy: boolean
    ) => {
        suppressDirtyRef.current = true;
        selectionDragRef.current = null;
        setSelectionBox(null);
        setSelectedNodeIds([]);
        onClearEditing();
        // 视野不随文件存储：按节点分布自适应铺满视口
        setState({ ...parsed, view: fitViewToNodes(parsed.nodes, windowSize.w, windowSize.h) });
        setCurrentFileName(fileName);
        setCurrentFilePath(filePath);
        setCurrentFileHandle(null);
        setIsLegacyProject(legacy);
        setDirty(false);
        // 打开/导入不是自写：清空自写时间戳，避免吞掉紧接着的外部修改事件
        lastSelfWriteRef.current = 0;
    };

    /** 外部修改后的重载：保留当前视野，不改变文件名/路径 */
    const applyExternalReload = (project: EditorState) => {
        suppressDirtyRef.current = true;
        selectionDragRef.current = null;
        setSelectionBox(null);
        setSelectedNodeIds([]);
        onClearEditing();
        setState((prev) => ({ ...project, view: prev.view }));
        setDirty(false);
    };

    /** 外部修改处理：干净则静默重载；有未保存修改则让用户选择 */
    const handleExternalChange = async () => {
        if (handlingExternalRef.current) return;
        const path = currentFilePathRef.current;
        if (!path) return;
        // 我们自己写盘后 1s 内的监听事件一律忽略（含写入到事件送达的窗口）
        if (Date.now() - lastSelfWriteRef.current < 1000) return;

        handlingExternalRef.current = true;
        try {
            let text: string | null = null;
            try {
                text = await invoke<string>("read_file", { path });
            } catch {
                return; // 文件被删除/移动，忽略
            }
            if (text == null) return;

            let project = deserializeProject(text);
            if (!project) project = parseGmlEditorData(text);
            if (!project) {
                alert("检测到对话工程文件被外部修改，但无法解析其内容。请人工检查该文件。");
                return;
            }

            if (!isDirtyRef.current) {
                applyExternalReload(project);
                return;
            }
            const res = await confirm(
                "对话工程文件已被外部修改（例如 AI Agent 或文本编辑器）。\n「重新加载」将丢弃当前未保存的本地修改；「保留本地」则下次保存会覆盖外部改动。",
                { title: "文件已被外部修改", kind: "warning" }
            );
            if (res) applyExternalReload(project);
            // res === false → 保留本地，下次保存覆盖外部改动
        } finally {
            handlingExternalRef.current = false;
        }
    };
    handleExternalChangeRef.current = handleExternalChange;

    // 监听当前工程文件，检测外部修改（冲突检测）
    useEffect(() => {
        if (unwatchRef.current) {
            unwatchRef.current();
            unwatchRef.current = null;
        }
        if (!isTauri() || !currentFilePath) return;

        const target = currentFilePath;
        // 监听父目录比监听单文件更稳：外部编辑器常以"临时文件+改名"原子替换，
        // 单文件监听会因文件句柄失效而漏报。这里按路径精确过滤掉相邻文件的动静。
        const { dir } = splitPath(target);
        let cancelled = false;
        watch(dir, (event) => {
            const normTarget = target.toLowerCase();
            if (!event.paths.some((p) => p.toLowerCase() === normTarget)) return;
            void handleExternalChangeRef.current();
        }, { delayMs: 300 })
            .then((unwatch) => {
                if (cancelled || unwatchRef.current) {
                    unwatch();
                    return;
                }
                unwatchRef.current = unwatch;
            })
            .catch((err) => console.warn("文件监听注册失败:", err));

        return () => {
            cancelled = true;
            if (unwatchRef.current) {
                unwatchRef.current();
                unwatchRef.current = null;
            }
        };
    }, [currentFilePath]);

    const onImport = (file: File) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target?.result as string;

            // 优先按新工程格式解析，失败再尝试旧版 .gml 迁移
            let project = deserializeProject(text);
            let legacy = false;
            if (!project) {
                project = parseGmlEditorData(text);
                legacy = project !== null;
            }
            if (!project) {
                alert("无法解析该文件：既不是 .dialogue.json 工程文件，也不含旧版编辑器元数据。");
                return;
            }

            applyLoadedProject(project, file.name || "新文件", (file as any).path ?? null, legacy);
            if (legacy) {
                alert("已从旧版 .gml 工程导入。保存时会引导你另存为 .dialogue.json 新格式，原文件不会被覆盖。");
            }
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
        const filePath = await open({
            filters: [
                { name: "对话工程文件", extensions: ["json"] },
                { name: "旧版 GML 工程", extensions: ["gml"] },
            ],
            multiple: false,
        });
        if (!filePath) return;

        const content = await invoke<string>("read_file", { path: filePath });
        if (!content) return;

        // 优先按新工程格式解析，失败再尝试旧版 .gml 迁移
        let project = deserializeProject(content);
        let legacy = false;
        if (!project) {
            project = parseGmlEditorData(content);
            legacy = project !== null;
        }
        if (!project) {
            alert("无法解析该文件：既不是 .dialogue.json 工程文件，也不含旧版编辑器元数据。");
            return;
        }

        const fileName = await invoke<string>("get_filename", { path: filePath });
        applyLoadedProject(project, fileName, filePath, legacy);
        if (legacy) {
            alert("已从旧版 .gml 工程导入。保存时会引导你另存为 .dialogue.json 新格式，原文件不会被覆盖。");
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
        handleSaveAndExport,
        handleExportGml,
        onImport,
        suppressDirtyRef,
    };
}
