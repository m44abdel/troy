// Agent status from what the terminal shows: output means working, silence or
// a bell means it is waiting on you, and the exit code says how it ended.
// Agents with hooks (Claude Code) report status directly, which beats guessing.

export type AgentStatus = 'idle' | 'running' | 'waiting' | 'done' | 'error'

// ponytail: fixed silence threshold; per-agent tuning if a CLI pauses longer mid-task.
export const IDLE_MS = 3000

// A resize makes TUIs redraw the whole screen; output this soon after one is a redraw, not work.
export const RESIZE_GRACE_MS = 500

const HOOK_STATUSES: readonly AgentStatus[] = ['running', 'waiting']

export const parseHookStatus = (data: string): AgentStatus | null =>
  HOOK_STATUSES.find((s) => s === data) ?? null

/** `certain` is false when the status is only guessed from a quiet spell or output. */
export type StatusListener = (status: AgentStatus, certain: boolean) => void

export interface StatusTracker {
  output(): void
  hook(status: AgentStatus): void
  resize(): void
  bell(): void
  exit(code: number): void
  dispose(): void
}

export function trackStatus(onChange: StatusListener, idleMs = IDLE_MS): StatusTracker {
  let current: AgentStatus = 'idle'
  let timer: ReturnType<typeof setTimeout> | undefined
  let redrawUntil = 0
  // Once a hook has reported, output and silence say nothing more.
  let hooked = false

  const set = (next: AgentStatus, certain: boolean): void => {
    clearTimeout(timer)
    if (next === current) return
    current = next
    onChange(next, certain)
  }

  return {
    output: () => {
      if (hooked) return
      // A redraw keeps a working agent working but never wakes a waiting one.
      if (Date.now() < redrawUntil && current !== 'running') return
      set('running', false)
      timer = setTimeout(() => set('waiting', false), idleMs)
    },
    hook: (status) => {
      hooked = true
      set(status, true)
    },
    resize: () => {
      redrawUntil = Date.now() + RESIZE_GRACE_MS
    },
    bell: () => {
      if (!hooked) set('waiting', true)
    },
    exit: (code) => set(code === 0 ? 'done' : 'error', true),
    dispose: () => clearTimeout(timer)
  }
}

export const isAlive = (status: AgentStatus | undefined): boolean =>
  status === 'running' || status === 'waiting'
