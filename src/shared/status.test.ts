import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { trackStatus, type AgentStatus } from './status'

describe('trackStatus', () => {
  let seen: AgentStatus[]
  let tracker: ReturnType<typeof trackStatus>

  beforeEach(() => {
    vi.useFakeTimers()
    seen = []
    tracker = trackStatus((s) => seen.push(s), 1000)
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
})
