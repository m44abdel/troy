import type { Terminal } from '@xterm/xterm'

// Mounted terminals by pane id, for the focus shortcuts.
export const terminals = new Map<string, Terminal>()

export const focusTerminal = (id: string): void => terminals.get(id)?.focus()

// Goes through the terminal's input path, so bracketed paste applies when the app asked for it.
export const pasteToTerminal = (id: string, text: string): void => terminals.get(id)?.paste(text)

export const agentId = (path: string): string => `${path}:agent`
/** A new shell pane in a worktree's terminal area. */
export const paneId = (path: string): string => `${path}:term:${crypto.randomUUID()}`

// The focused pane of each worktree, so coming back to one puts the cursor where it was.
export const focusedPanes = new Map<string, string>()
export const focusWorktree = (path: string): void =>
  focusTerminal(focusedPanes.get(path) ?? agentId(path))

export function submitToTerminal(id: string, text: string): boolean {
  const term = terminals.get(id)
  if (!term) return false
  term.paste(text)
  term.input('\r')
  return true
}

/** A tab some other part of the window wants opened in a worktree's terminal area. */
export type TabRequest =
  | { kind: 'preview'; file: string; line?: number }
  | { kind: 'command'; title: string; command: string }

// Held until that worktree's terminal area mounts, e.g. a session resumed in a worktree not
// opened yet.
const tabRequests = new Map<string, TabRequest[]>()
const tabListeners = new Map<string, (req: TabRequest) => void>()

export function requestTab(path: string, req: TabRequest): void {
  const listener = tabListeners.get(path)
  if (listener) return listener(req)
  tabRequests.set(path, [...(tabRequests.get(path) ?? []), req])
}

export function onTabRequest(path: string, listener: (req: TabRequest) => void): () => void {
  tabListeners.set(path, listener)
  const waiting = tabRequests.get(path) ?? []
  tabRequests.delete(path)
  waiting.forEach(listener)
  return () => {
    if (tabListeners.get(path) === listener) tabListeners.delete(path)
  }
}
