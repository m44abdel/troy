import { describe, expect, it } from 'vitest'
import { createVim, type VimZone } from './vim'

const feed = (zone: VimZone, keys: string[]): unknown[] => {
  const vim = createVim()
  return keys.map((k) => vim(zone, k))
}

describe('createVim', () => {
  it('single keys', () => {
    expect(feed('sidebar', ['j', 'k', 'G', 'Enter'])).toEqual(['down', 'up', 'bottom', 'open'])
  })

  it('gg and ]c wait for their second key', () => {
    expect(feed('sidebar', ['g', 'g'])).toEqual(['pending', 'top'])
    expect(feed('diff', [']', 'c', '[', 'c'])).toEqual([
      'pending',
      'nextHunk',
      'pending',
      'prevHunk'
    ])
  })

  it('g followed by j still moves down', () => {
    expect(feed('sidebar', ['g', 'j'])).toEqual(['pending', 'down'])
    expect(feed('sidebar', ['g', 'x', 'j'])).toEqual(['pending', null, 'down'])
  })

  it('unbound keys give null', () => {
    expect(feed('sidebar', [']', 'c'])).toEqual([null, null])
    expect(feed('diff', ['Enter', 'q'])).toEqual([null, null])
  })
})
