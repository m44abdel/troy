import type { Terminal } from '@xterm/xterm'

// Mounted terminals by pane id, so app shortcuts can move focus between them.
export const terminals = new Map<string, Terminal>()

export const focusTerminal = (id: string): void => terminals.get(id)?.focus()

// Goes through the terminal's input path, so bracketed paste applies when the app asked for it.
export const pasteToTerminal = (id: string, text: string): void => terminals.get(id)?.paste(text)

export const agentId = (path: string): string => `${path}:agent`
export const shellId = (path: string): string => `${path}:shell`
