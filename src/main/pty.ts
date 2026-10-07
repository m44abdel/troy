import { app, ipcMain, type WebContents } from 'electron'
import { existsSync, mkdirSync, rmSync, watch } from 'fs'
import { readFile } from 'fs/promises'
import * as pty from 'node-pty'
import { join } from 'path'
import { parseHookStatus } from '../shared/status'

const ptys = new Map<string, pty.IPty>()
// Who to tell when a pane's agent hooks write its status file.
const listeners = new Map<string, WebContents>()
let nextId = 0

const statusDir = (): string => join(app.getPath('userData'), 'status')

// Hooks write "running" or "waiting" to the file named in TROY_STATUS_FILE, one per pane.
function watchStatus(): void {
  rmSync(statusDir(), { recursive: true, force: true })
  mkdirSync(statusDir(), { recursive: true })
  watch(statusDir(), (_event, id) => {
    const target = id && listeners.get(id)
    if (!target) return
    // A change event can arrive mid-write; an empty or partial read is just skipped.
    readFile(join(statusDir(), id), 'utf8')
      .then((text) => {
        const status = parseHookStatus(text.trim())
        if (status) send(target, `pty:status:${id}`, status)
      })
      .catch(() => {})
  })
}

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: [] }
  // Login shell so a Finder-launched app still gets the user's PATH.
  return { file: process.env.SHELL || '/bin/zsh', args: ['-l'] }
}

function send(target: WebContents, channel: string, ...args: unknown[]): void {
  if (!target.isDestroyed()) target.send(channel, ...args)
}

export function registerPty(): void {
  watchStatus()
  ipcMain.handle('pty:spawn', (event, cwd: unknown, cols: unknown, rows: unknown, env: unknown) => {
    if (typeof cwd !== 'string' || !existsSync(cwd)) throw new Error(`Not a directory: ${cwd}`)
    const extraEnv = Object.fromEntries(
      Object.entries(env ?? {}).filter(([, v]) => typeof v === 'string')
    )
    const { file, args } = defaultShell()
    const id = String(++nextId)
    const proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cwd,
      cols: Number(cols) || 80,
      rows: Number(rows) || 24,
      env: {
        ...process.env,
        ...extraEnv,
        TERM_PROGRAM: 'troy',
        TROY_STATUS_FILE: join(statusDir(), id)
      } as Record<string, string>
    })
    proc.onData((data) => send(event.sender, `pty:data:${id}`, data))
    listeners.set(id, event.sender)
    proc.onExit(({ exitCode }) => {
      ptys.delete(id)
      listeners.delete(id)
      rmSync(join(statusDir(), id), { force: true })
      send(event.sender, `pty:exit:${id}`, exitCode)
    })
    ptys.set(id, proc)
    return id
  })

  ipcMain.on('pty:write', (_e, id: string, data: string) => ptys.get(id)?.write(data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => {
    if (cols > 0 && rows > 0) ptys.get(id)?.resize(cols, rows)
  })
  ipcMain.on('pty:kill', (_e, id: string) => ptys.get(id)?.kill())

  app.on('before-quit', () => ptys.forEach((p) => p.kill()))
}
