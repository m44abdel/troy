import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppAction } from '../shared/keys'

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  listRepos: (): Promise<string[]> => ipcRenderer.invoke('repos:list'),
  addRepo: (): Promise<{ repos: string[]; added?: string; error?: string }> =>
    ipcRenderer.invoke('repos:add'),

  ptySpawn: (cwd: string, cols: number, rows: number): Promise<string> =>
    ipcRenderer.invoke('pty:spawn', cwd, cols, rows),
  ptyWrite: (id: string, data: string): void => ipcRenderer.send('pty:write', id, data),
  ptyResize: (id: string, cols: number, rows: number): void =>
    ipcRenderer.send('pty:resize', id, cols, rows),
  ptyKill: (id: string): void => ipcRenderer.send('pty:kill', id),
  onPtyData: (id: string, cb: (data: string) => void) => subscribe(`pty:data:${id}`, cb),
  onPtyExit: (id: string, cb: (code: number) => void) => subscribe(`pty:exit:${id}`, cb),

  onAction: (cb: (action: AppAction) => void) => subscribe('app:action', cb)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
