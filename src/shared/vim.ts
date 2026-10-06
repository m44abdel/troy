// Opt-in vim keys for the panes that aren't terminals. Terminals never see these.

export type VimZone = 'sidebar' | 'diff'
export type VimCommand = 'down' | 'up' | 'top' | 'bottom' | 'open' | 'nextHunk' | 'prevHunk'

const KEYMAPS: Record<VimZone, Record<string, VimCommand>> = {
  sidebar: { j: 'down', k: 'up', gg: 'top', G: 'bottom', Enter: 'open' },
  diff: { j: 'down', k: 'up', gg: 'top', G: 'bottom', ']c': 'nextHunk', '[c': 'prevHunk' }
}

/**
 * Feeds keys one at a time. Returns the command a sequence completes, 'pending'
 * while it is a prefix of one (the key is still consumed), or null if unbound.
 */
export function createVim(): (zone: VimZone, key: string) => VimCommand | 'pending' | null {
  let pending = ''
  return (zone, key) => {
    const keymap = KEYMAPS[zone]
    // After a dead prefix ("g" then "j"), the key still counts on its own.
    for (const seq of pending ? [pending + key, key] : [key]) {
      if (keymap[seq]) {
        pending = ''
        return keymap[seq]
      }
      if (Object.keys(keymap).some((k) => k.length > seq.length && k.startsWith(seq))) {
        pending = seq
        return 'pending'
      }
    }
    pending = ''
    return null
  }
}
