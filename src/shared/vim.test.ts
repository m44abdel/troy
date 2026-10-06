import { describe, expect, it } from 'vitest'
import { createVim, type VimZone } from './vim'

const feed = (zone: VimZone, keys: string[]): unknown[] => {
  const vim = createVim()
  return keys.map((k) => vim(zone, k))
}

describe('createVim', () => {
  it('maps single keys and two-key sequences per zone', () => {
    expect(feed('sidebar', ['j', 'k', 'G', 'Enter'])).toEqual(['down', 'up', 'bottom', 'open'])
    expect(feed('sidebar', ['g', 'g'])).toEqual(['pending', 'top'])
    expect(feed('diff', [']', 'c', '[', 'c'])).toEqual([
      'pending',
      'nextHunk',
      'pending',
      'prevHunk'
    ])
  })

  it('drops a dead prefix but still honours the key that broke it', () => {
    expect(feed('sidebar', ['g', 'j'])).toEqual(['pending', 'down'])
    expect(feed('sidebar', ['g', 'x', 'j'])).toEqual(['pending', null, 'down'])
  })

  it('ignores keys a zone does not bind', () => {
    expect(feed('sidebar', [']', 'c'])).toEqual([null, null])
    expect(feed('diff', ['Enter', 'q'])).toEqual([null, null])
  })
})
