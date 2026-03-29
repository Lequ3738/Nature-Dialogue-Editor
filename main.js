// 导入Electron核心模块
const { app, BrowserWindow } = require('electron');
const path = require('path');

// 创建窗口函数
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1000,   // 窗口宽度
    height: 800,   // 窗口高度
    webPreferences: {
      nodeIntegration: true,        // 关键：允许JS调用Node.js API（读写文件）
      contextIsolation: false      // 关闭隔离，配合上面的配置
    }
  });

  // 加载你的HTML文件（这里加载根目录的index.html，替换成你的文件名即可）
  mainWindow.loadFile('index.html');

  // 打开开发者工具（可选，调试用）
  // mainWindow.webContents.openDevTools();
}

// 应用启动后创建窗口
app.whenReady().then(createWindow);

// 关闭窗口退出程序
app.on('window-all-closed', () => app.quit());