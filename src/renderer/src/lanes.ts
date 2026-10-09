import type { AgentStatus } from '../../shared/status'

// Who needs you first, then what's moving, then what's settled.
export const LANES: readonly AgentStatus[] = ['waiting', 'running', 'idle', 'done', 'error']

/** Items per lane, in their sidebar order. */
export function groupByStatus<T>(
  items: T[],
  status: (item: T) => AgentStatus
): Record<AgentStatus, T[]> {
  const lanes = Object.fromEntries(LANES.map((s) => [s, [] as T[]])) as Record<AgentStatus, T[]>
  for (const item of items) lanes[status(item)].push(item)
  return lanes
}
