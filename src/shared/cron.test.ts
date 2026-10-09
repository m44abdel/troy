import { describe, expect, it } from 'vitest'
import { parseCron } from './cron'

// Local time, as the scheduler sees it. 2026-10-09 is a Friday.
const at = (y: number, mo: number, d: number, h: number, mi: number): Date =>
  new Date(y, mo - 1, d, h, mi)

describe('parseCron', () => {
  it('matches every minute with stars', () => {
    expect(parseCron('* * * * *')(at(2026, 10, 9, 13, 7))).toBe(true)
  })

  it('matches lists, ranges and steps', () => {
    const weekdayMornings = parseCron('0,30 9-11 * * 1-5')
    expect(weekdayMornings(at(2026, 10, 9, 9, 30))).toBe(true)
    expect(weekdayMornings(at(2026, 10, 9, 12, 0))).toBe(false)
    expect(weekdayMornings(at(2026, 10, 10, 9, 0))).toBe(false) // Saturday
    const everyFifteen = parseCron('*/15 * * * *')
    expect([0, 15, 30, 45].every((m) => everyFifteen(at(2026, 1, 1, 0, m)))).toBe(true)
    expect(everyFifteen(at(2026, 1, 1, 0, 20))).toBe(false)
  })

  it('treats 7 as Sunday and ORs the two day fields when both are set', () => {
    expect(parseCron('0 0 * * 7')(at(2026, 10, 11, 0, 0))).toBe(true)
    const firstOrFriday = parseCron('0 0 1 * 5')
    expect(firstOrFriday(at(2026, 10, 9, 0, 0))).toBe(true)
    expect(firstOrFriday(at(2026, 10, 1, 0, 0))).toBe(true)
    expect(firstOrFriday(at(2026, 10, 8, 0, 0))).toBe(false)
  })

  it('rejects malformed or out-of-range schedules', () => {
    expect(() => parseCron('* * * *')).toThrow('five fields')
    expect(() => parseCron('60 * * * *')).toThrow('outside')
    expect(() => parseCron('a * * * *')).toThrow("Can't read")
    expect(() => parseCron('*/0 * * * *')).toThrow('outside')
  })
})
