// Agent status from what the terminal shows: output means working, silence or
// a bell means it is waiting on you, and the exit code says how it ended.

export type AgentStatus = 'idle' | 'running' | 'waiting' | 'done' | 'error'

// ponytail: fixed silence threshold; per-agent tuning if a CLI pauses longer mid-task.
export const IDLE_MS = 3000

// A resize makes TUIs redraw the whole screen; output this soon after one is a redraw, not work.
export const RESIZE_GRACE_MS = 500

export interface StatusTracker {
  output(): void
  resize(): void
  bell(): void
  exit(code: number): void
  dispose(): void
}

export function trackStatus(
  onChange: (status: AgentStatus) => void,
  idleMs = IDLE_MS
): StatusTracker {
  let current: AgentStatus = 'idle'
  let timer: ReturnType<typeof setTimeout> | undefined
  let redrawUntil = 0

  const set = (next: AgentStatus): void => {
    clearTimeout(timer)
    if (next === current) return
    current = next
    onChange(next)
  }

  return {
    output: () => {
      // A redraw keeps a working agent working but never wakes a waiting one.
      if (Date.now() < redrawUntil && current !== 'running') return
      set('running')
      timer = setTimeout(() => set('waiting'), idleMs)
    },
    resize: () => {
      redrawUntil = Date.now() + RESIZE_GRACE_MS
    },
    bell: () => set('waiting'),
    exit: (code) => set(code === 0 ? 'done' : 'error'),
    dispose: () => clearTimeout(timer)
  }
}

export const isAlive = (status: AgentStatus | undefined): boolean =>
  status === 'running' || status === 'waiting'
