import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseHookStatus, trackStatus, type AgentStatus } from './status'

describe('trackStatus', () => {
  let seen: AgentStatus[]
  let certain: boolean[]
  let tracker: ReturnType<typeof trackStatus>

  beforeEach(() => {
    vi.useFakeTimers()
    seen = []
    certain = []
    tracker = trackStatus((s, sure) => {
      seen.push(s)
      certain.push(sure)
    }, 1000)
  })

  afterEach(() => {
    tracker.dispose()
    vi.useRealTimers()
  })

  it('is running while output flows and waiting after a quiet spell', () => {
    tracker.output()
    vi.advanceTimersByTime(900)
    tracker.output()
    vi.advanceTimersByTime(900)
    expect(seen).toEqual(['running'])

    vi.advanceTimersByTime(100)
    expect(seen).toEqual(['running', 'waiting'])
  })

  it('treats a bell as waiting right away', () => {
    tracker.output()
    tracker.bell()
    vi.advanceTimersByTime(5000)
    expect(seen).toEqual(['running', 'waiting'])
  })

  it('ignores the redraw a resize triggers while waiting', () => {
    tracker.output()
    vi.advanceTimersByTime(1000)
    expect(seen).toEqual(['running', 'waiting'])

    tracker.resize()
    tracker.output()
    vi.advanceTimersByTime(5000)
    expect(seen).toEqual(['running', 'waiting'])

    tracker.output()
    expect(seen).toEqual(['running', 'waiting', 'running'])
  })

  it('keeps a working agent working through a long resize drag', () => {
    tracker.output()
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(200)
      tracker.resize()
      tracker.output()
    }
    expect(seen).toEqual(['running'])
  })

  it('maps exit codes to done or error and stops the idle timer', () => {
    tracker.output()
    tracker.exit(0)
    vi.advanceTimersByTime(5000)
    expect(seen).toEqual(['running', 'done'])

    tracker.output()
    tracker.exit(127)
    expect(seen).toEqual(['running', 'done', 'running', 'error'])
  })
  it('trusts hook reports over the silence timer once one arrives', () => {
    tracker.hook('running')
    tracker.output()
    vi.advanceTimersByTime(5000)
    expect(seen).toEqual(['running'])

    tracker.hook('waiting')
    tracker.output()
    tracker.bell()
    vi.advanceTimersByTime(5000)
    expect(seen).toEqual(['running', 'waiting'])
  })

  it('marks hook, bell and exit changes as certain but a quiet spell as a guess', () => {
    tracker.output()
    vi.advanceTimersByTime(1000)
    tracker.bell()
    tracker.output()
    tracker.exit(0)
    expect(seen).toEqual(['running', 'waiting', 'running', 'done'])
    expect(certain).toEqual([false, false, false, true])

    tracker.hook('waiting')
    expect(certain.at(-1)).toBe(true)
  })
})

describe('parseHookStatus', () => {
  it('accepts only the statuses a hook may report', () => {
    expect(parseHookStatus('waiting')).toBe('waiting')
    expect(parseHookStatus('running')).toBe('running')
    expect(parseHookStatus('done')).toBeNull()
    expect(parseHookStatus('waiting;rm -rf')).toBeNull()
  })
})
