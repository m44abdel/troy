import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { promisify } from 'util'

const run = promisify(execFile)

interface State {
  repos: string[]
}

const statePath = (): string => join(app.getPath('userData'), 'state.json')

async function loadState(): Promise<State> {
  try {
    const parsed = JSON.parse(await readFile(statePath(), 'utf8'))
    const repos = Array.isArray(parsed?.repos)
      ? parsed.repos.filter((r: unknown): r is string => typeof r === 'string')
      : []
    return { repos }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
      console.error('Unreadable state.json', err)
    return { repos: [] }
  }
}

async function saveState(state: State): Promise<void> {
  await writeFile(statePath(), JSON.stringify(state, null, 2))
}

async function gitToplevel(dir: string): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', dir, 'rev-parse', '--show-toplevel'])
    return stdout.trim()
  } catch {
    return null
  }
}

export function registerRepos(): void {
  ipcMain.handle('repos:list', async () => (await loadState()).repos)

  ipcMain.handle('repos:add', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'Add a git repository', properties: ['openDirectory' as const] }
    const pick = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    const state = await loadState()
    if (pick.canceled || !pick.filePaths[0]) return { repos: state.repos }

    const top = await gitToplevel(pick.filePaths[0])
    if (!top)
      return { repos: state.repos, error: `${pick.filePaths[0]} is not inside a git repository.` }
    if (state.repos.includes(top)) return { repos: state.repos, added: top }

    const next = { repos: [...state.repos, top] }
    await saveState(next)
    return { repos: next.repos, added: top }
  })
}
