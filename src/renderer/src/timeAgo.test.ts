import { describe, expect, it } from 'vitest'
import { timeAgo } from './timeAgo'

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0)
const ago = (ms: number): string => timeAgo(NOW - ms, NOW)

describe('timeAgo', () => {
  it('rounds down to the largest unit that fits', () => {
    expect(ago(20_000)).toBe('just now')
    expect(ago(90_000)).toBe('1m ago')
    expect(ago(3 * 3_600_000 + 59 * 60_000)).toBe('3h ago')
    expect(ago(13 * 86_400_000)).toBe('13d ago')
  })

  it('gives a date past a month', () => {
    expect(ago(40 * 86_400_000)).toBe(new Date(NOW - 40 * 86_400_000).toLocaleDateString())
  })
})
