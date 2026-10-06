import type { AgentStatus } from '../../shared/status'

export const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'not started',
  running: 'working',
  waiting: 'waiting',
  done: 'finished',
  error: 'exited with an error'
}
