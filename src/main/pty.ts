import { app, ipcMain, type WebContents } from 'electron'
import { existsSync } from 'fs'
import * as pty from 'node-pty'

const ptys = new Map<string, pty.IPty>()
let nextId = 0

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: [] }
  // Login shell so a Finder-launched app still gets the user's PATH.
  return { file: process.env.SHELL || '/bin/zsh', args: ['-l'] }
}

function send(target: WebContents, channel: string, ...args: unknown[]): void {
  if (!target.isDestroyed()) target.send(channel, ...args)
}

export function registerPty(): void {
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
      env: { ...process.env, ...extraEnv, TERM_PROGRAM: 'troy' } as Record<string, string>
    })
    proc.onData((data) => send(event.sender, `pty:data:${id}`, data))
    proc.onExit(({ exitCode }) => {
      ptys.delete(id)
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
