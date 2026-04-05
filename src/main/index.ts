import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs";

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        webPreferences: {
            // Keep current behavior to avoid breaking renderer features.
            nodeIntegration: true,
            contextIsolation: false,
        },
        autoHideMenuBar: true,
    });

    mainWindow.removeMenu();
    mainWindow.setMenuBarVisibility(false);

    if (!app.isPackaged)
        mainWindow.webContents.openDevTools({mode:'detach'});

    let isDirty = false;
    ipcMain.on("editor:dirty", (_event, payload: { dirty?: boolean }) => {
        isDirty = !!payload?.dirty;
    });

    // Handle file save requests from renderer process
    ipcMain.handle("editor:save-file", async (_event, filePath: string, content: string) => {
        try {
            fs.writeFileSync(filePath, content, "utf8");
            return { success: true };
        } catch (error) {
            console.error("Failed to save file:", error);
            return { success: false, error: String(error) };
        }
    });

    // 处理另存为对话框
    ipcMain.handle("dialog:save", async (_event, defaultName: string) => {
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            defaultPath: defaultName,
            filters: [{ name: "GML Files", extensions: ["gml"] }]
        });
        return canceled ? null : filePath;
    });

    // 处理打开文件对话框
    ipcMain.handle("dialog:open", async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            properties: ["openFile"],
            filters: [{ name: "GML Files", extensions: ["gml"] }]
        });
        return canceled ? null : filePaths[0];
    });

    // 读取文件内容
    ipcMain.handle("editor:read-file", async (_event, filePath: string) => {
        try {
            return fs.readFileSync(filePath, "utf8");
        } catch (error) {
            console.error("Read file error:", error);
            return null;
        }
    });

    ipcMain.handle("editor:default-profile", () => {
        return dialog.showMessageBoxSync(mainWindow, {
            type: "warning",
            buttons: ["取消", "继续"],
            defaultId: 0,
            cancelId: 0,
            message: "将会覆盖现有的代码编辑器配置，是否继续？",
        });
    });

    mainWindow.on("close", (e) => {
        if (!isDirty) return;
        const res = dialog.showMessageBoxSync(mainWindow, {
            type: "warning",
            buttons: ["取消", "退出"],
            defaultId: 0,
            cancelId: 0,
            message: "文件尚未保存，确定要退出吗？",
        });
        if (res === 0) {
            e.preventDefault();
        }
    });

    // In dev, vite-plugin-electron sets VITE_DEV_SERVER_URL.
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
        // In production, Vite builds renderer into /dist.
        mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
    }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
    app.quit();
});
