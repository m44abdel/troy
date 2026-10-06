// Agent status from what the terminal shows: output means working, silence or
// a bell means it is waiting on you, and the exit code says how it ended.

export type AgentStatus = 'idle' | 'running' | 'waiting' | 'done' | 'error'

// ponytail: fixed silence threshold; per-agent tuning if a CLI pauses longer mid-task.
export const IDLE_MS = 3000

export interface StatusTracker {
  output(): void
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

  const set = (next: AgentStatus): void => {
    clearTimeout(timer)
    if (next === current) return
    current = next
    onChange(next)
  }

  return {
    output: () => {
      set('running')
      timer = setTimeout(() => set('waiting'), idleMs)
    },
    bell: () => set('waiting'),
    exit: (code) => set(code === 0 ? 'done' : 'error'),
    dispose: () => clearTimeout(timer)
  }
}

export const isAlive = (status: AgentStatus | undefined): boolean =>
  status === 'running' || status === 'waiting'
