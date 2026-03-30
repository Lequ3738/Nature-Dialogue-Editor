import { app, BrowserWindow, dialog, ipcMain } from 'electron'

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
  })

  mainWindow.removeMenu()
  mainWindow.setMenuBarVisibility(false)

  let isDirty = false
  ipcMain.on('editor:dirty', (_event, payload: { dirty?: boolean }) => {
    isDirty = !!payload?.dirty
  })

  mainWindow.on('close', (e) => {
    if (!isDirty) return
    const res = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['取消', '退出'],
      defaultId: 0,
      cancelId: 0,
      message: '文件尚未保存，确定要退出吗？',
    })
    if (res === 0) {
      e.preventDefault()
    }
  })

  // In dev, vite-plugin-electron sets VITE_DEV_SERVER_URL.
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    // In production, Vite builds renderer into /dist.
    mainWindow.loadFile('dist/index.html')
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  app.quit()
})

