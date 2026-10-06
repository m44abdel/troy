import type { Terminal } from '@xterm/xterm'

// Mounted terminals by pane id, so app shortcuts can move focus between them.
export const terminals = new Map<string, Terminal>()

export const focusTerminal = (id: string): void => terminals.get(id)?.focus()
