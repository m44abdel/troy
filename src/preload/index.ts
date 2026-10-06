import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppAction } from '../shared/keys'
import type { Overlap } from '../shared/overlap'
import type {
  ContextUsage,
  CreateRequest,
  Knowledge,
  Repo,
  ReposResult,
  Settings
} from '../shared/types'

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  listRepos: (): Promise<Repo[]> => ipcRenderer.invoke('repos:list'),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setSettings: (next: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke('settings:set', next),
  openKeybindings: (): Promise<string> => ipcRenderer.invoke('settings:openKeybindings'),
  installedAgents: (): Promise<string[]> => ipcRenderer.invoke('agents:installed'),
  addRepo: (): Promise<ReposResult & { added?: string }> => ipcRenderer.invoke('repos:add'),
  createWorktree: (
    repo: string,
    req: CreateRequest
  ): Promise<ReposResult & { path?: string; setup?: boolean }> =>
    ipcRenderer.invoke('worktree:create', repo, req),
  overlaps: (): Promise<Record<string, Overlap[]>> => ipcRenderer.invoke('worktrees:overlaps'),
  archiveWorktree: (repo: string, path: string): Promise<ReposResult> =>
    ipcRenderer.invoke('worktree:archive', repo, path),
  contextUsage: (path: string, agent: string): Promise<ContextUsage | null> =>
    ipcRenderer.invoke('context:get', path, agent),
  diff: (path: string): Promise<{ diff?: string; error?: string }> =>
    ipcRenderer.invoke('worktree:diff', path),
  commit: (path: string, message: string): Promise<{ error?: string }> =>
    ipcRenderer.invoke('worktree:commit', path, message),
  push: (path: string): Promise<{ error?: string }> => ipcRenderer.invoke('worktree:push', path),
  openPullRequest: (path: string): Promise<{ error?: string }> =>
    ipcRenderer.invoke('worktree:pr', path),
  docs: (path: string): Promise<{ files?: string[]; error?: string }> =>
    ipcRenderer.invoke('docs:list', path),
  readDoc: (path: string, file: string): Promise<{ text?: string; error?: string }> =>
    ipcRenderer.invoke('docs:read', path, file),
  knowledge: (path: string): Promise<Knowledge | { error: string }> =>
    ipcRenderer.invoke('knowledge:get', path),
  approveFact: (path: string, id: string): Promise<{ error?: string }> =>
    ipcRenderer.invoke('knowledge:approve', path, id),
  rejectFact: (path: string, id: string): Promise<{ error?: string }> =>
    ipcRenderer.invoke('knowledge:reject', path, id),

  ptySpawn: (
    cwd: string,
    cols: number,
    rows: number,
    env?: Record<string, string>
  ): Promise<string> => ipcRenderer.invoke('pty:spawn', cwd, cols, rows, env),
  ptyWrite: (id: string, data: string): void => ipcRenderer.send('pty:write', id, data),
  ptyResize: (id: string, cols: number, rows: number): void =>
    ipcRenderer.send('pty:resize', id, cols, rows),
  ptyKill: (id: string): void => ipcRenderer.send('pty:kill', id),
  onPtyData: (id: string, cb: (data: string) => void) => subscribe(`pty:data:${id}`, cb),
  onPtyExit: (id: string, cb: (code: number) => void) => subscribe(`pty:exit:${id}`, cb),

  setBadge: (count: number): void => ipcRenderer.send('app:badge', count),
  onAction: (cb: (action: AppAction) => void) => subscribe('app:action', cb)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
