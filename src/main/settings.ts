import { app, ipcMain, shell } from 'electron'
import { watchFile } from 'fs'
import { access, constants, readFile, writeFile } from 'fs/promises'
import { delimiter, join } from 'path'
import { DEFAULT_BINDINGS, parseBindings, type Bindings } from '../shared/keys'
import { KNOWN_AGENTS } from '../shared/shell'
import type { Settings } from '../shared/types'

const BINDINGS_POLL_MS = 1000
const DEFAULT_SETTINGS: Settings = { vim: false }

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')
export const keybindingsPath = (): string => join(app.getPath('userData'), 'keybindings.json')

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`Unreadable ${path}`, err)
    return undefined
  }
}

export async function loadSettings(): Promise<Settings> {
  const raw = (await readJson(settingsPath())) as Partial<Settings> | undefined
  return { vim: typeof raw?.vim === 'boolean' ? raw.vim : DEFAULT_SETTINGS.vim }
}

/** Reads keybindings.json, first writing the defaults so there is a file to edit. */
export async function loadBindings(): Promise<Bindings> {
  const path = keybindingsPath()
  const raw = await readJson(path)
  if (raw === undefined) {
    await writeFile(path, JSON.stringify(DEFAULT_BINDINGS, null, 2) + '\n', { flag: 'wx' }).catch(
      () => undefined
    )
    return DEFAULT_BINDINGS
  }
  const { bindings, ignored } = parseBindings(raw)
  if (ignored.length) console.warn(`Ignored in ${path}:`, ignored.join(', '))
  return bindings
}

/** Re-reads keybindings.json whenever it changes, so edits apply without a restart. */
export function watchBindings(onChange: (bindings: Bindings) => void): void {
  watchFile(keybindingsPath(), { interval: BINDINGS_POLL_MS }, () => {
    loadBindings().then(onChange)
  })
}

// ponytail: plain PATH scan, no Windows PATHEXT; add .exe/.cmd lookup with Windows support.
export async function installedAgents(): Promise<string[]> {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const found = await Promise.all(
    KNOWN_AGENTS.map((agent) =>
      Promise.any(dirs.map((dir) => access(join(dir, agent), constants.X_OK))).then(
        () => true,
        () => false
      )
    )
  )
  return KNOWN_AGENTS.filter((_, i) => found[i])
}

export function registerSettings(): void {
  ipcMain.handle('settings:get', loadSettings)
  ipcMain.handle('settings:set', async (_e, next: unknown) => {
    const vim = (next as Partial<Settings>)?.vim
    const settings = { ...(await loadSettings()), ...(typeof vim === 'boolean' ? { vim } : {}) }
    await writeFile(settingsPath(), JSON.stringify(settings, null, 2))
    return settings
  })
  ipcMain.handle('settings:openKeybindings', async () => {
    await loadBindings()
    return shell.openPath(keybindingsPath())
  })
  ipcMain.handle('agents:installed', installedAgents)
}
