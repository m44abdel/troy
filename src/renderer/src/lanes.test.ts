import { describe, expect, it } from 'vitest'
import type { AgentStatus } from '../../shared/status'
import { groupByStatus } from './lanes'

describe('groupByStatus', () => {
  it('puts each item in its status lane and keeps the given order within a lane', () => {
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
