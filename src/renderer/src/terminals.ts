import type { Terminal } from '@xterm/xterm'

// Mounted terminals by pane id, so app shortcuts can move focus between them.
export const terminals = new Map<string, Terminal>()

export const focusTerminal = (id: string): void => terminals.get(id)?.focus()

// Goes through the terminal's input path, so bracketed paste applies when the app asked for it.
export const pasteToTerminal = (id: string, text: string): void => terminals.get(id)?.paste(text)

export const agentId = (path: string): string => `${path}:agent`
export const shellId = (path: string): string => `${path}:shell`
export const drawerId = (path: string): string => `${path}:drawer`

// Which of a drawer's terminal tabs is showing, by drawer id.
export const activeDrawerTab = new Map<string, string>()

export const focusDrawer = (id: string): void => focusTerminal(activeDrawerTab.get(id) ?? id)

/** Pastes text into a pane and presses Enter, as if typed and sent. */
export function submitToTerminal(id: string, text: string): boolean {
  const term = terminals.get(id)
  if (!term) return false
  term.paste(text)
  term.input('\r')
  return true
}
