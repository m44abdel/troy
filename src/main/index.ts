import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { DEFAULT_BINDINGS, routeKey } from '../shared/keys'
import { registerPty } from './pty'
import { registerRepos } from './repos'
import { writeMcpConfig } from './mcp-config'
import { adoptLoginPath } from './path'
import { loadBindings, registerSettings, watchBindings } from './settings'

let bindings = DEFAULT_BINDINGS

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // App shortcuts are claimed here, before the page or the terminal sees them.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const action = routeKey(input, process.platform, bindings)
    if (!action) return
    event.preventDefault()
    mainWindow.webContents.send('app:action', action)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Lets tests run against a throwaway profile instead of the real one.
if (process.env.TROY_USER_DATA) app.setPath('userData', process.env.TROY_USER_DATA)

app.whenReady().then(async () => {
  await adoptLoginPath()
  electronApp.setAppUserModelId('dev.troy.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await writeMcpConfig().catch((err) => console.error('Could not write the MCP config', err))
  bindings = await loadBindings()
  watchBindings((next) => (bindings = next))
  registerSettings()
  registerPty()
  registerRepos()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
