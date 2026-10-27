import { describe, expect, it } from 'vitest'
import { countdown, memory } from './format'

describe('countdown', () => {
  it('reads like Orca: hours and minutes, or minutes alone', () => {
    expect(countdown((3 * 60 + 43) * 60_000 + 30_000)).toBe('3h 43m')
    expect(countdown(42 * 60_000)).toBe('42m')
    expect(countdown(20_000)).toBe('<1m')
  })

  it('has nothing to say once the time has passed', () => {
    expect(countdown(-1)).toBeNull()
  })
})

describe('memory', () => {
  it('switches to GB past a gigabyte', () => {
    expect(memory(512)).toBe('512 MB')
    expect(memory(1260)).toBe('1.23 GB')
  })
})
