import { app, shell, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { DEFAULT_BINDINGS, routeKey } from '../shared/keys'
import { registerPty } from './pty'
import { registerRepos } from './repos'
import { writeMcpConfig } from './mcp-config'
import { withoutSessionMarkers } from './env'
import { adoptLoginPath } from './path'
import { loadBindings, registerSettings, watchBindings } from './settings'

let bindings = DEFAULT_BINDINGS

function createWindow(): void {
  // Troy is dark-only; this keeps native vibrancy and menus dark too.
  nativeTheme.themeSource = 'dark'
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // On macOS the sidebar shows the desktop through native vibrancy.
    ...(process.platform === 'darwin'
      ? {
          vibrancy: 'sidebar' as const,
          visualEffectState: 'active' as const,
          backgroundColor: '#00000000',
          trafficLightPosition: { x: 16, y: 18 }
        }
      : { backgroundColor: '#0b0b12' }),
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

  // Links leave the app for the browser; nothing else may navigate the window.
  const openExternal = (url: string): void => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    openExternal(url)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Everything Troy spawns inherits process.env, so clean it once, before anything runs.
process.env = withoutSessionMarkers(process.env)

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
  // The dock badge counts agents waiting on you.
  ipcMain.on('app:badge', (_e, count: unknown) => {
    if (Number.isInteger(count) && (count as number) >= 0) app.setBadgeCount(count as number)
  })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
