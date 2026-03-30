import { app, BrowserWindow } from 'electron'

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      // Keep current behavior to avoid breaking renderer features.
      nodeIntegration: true,
      contextIsolation: false,
    },
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

