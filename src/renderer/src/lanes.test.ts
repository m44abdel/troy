import { describe, expect, it } from 'vitest'
import type { AgentStatus } from '../../shared/status'
import { groupByStatus } from './lanes'

describe('groupByStatus', () => {
  it('keeps input order inside each lane', () => {
    const status: Record<string, AgentStatus> = {
      a: 'running',
      b: 'waiting',
      c: 'running',
      d: 'error'
    }
    expect(groupByStatus(['a', 'b', 'c', 'd'], (x) => status[x])).toEqual({
      waiting: ['b'],
      running: ['a', 'c'],
      idle: [],
      done: [],
      error: ['d']
    })
  })
})
