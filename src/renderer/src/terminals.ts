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
