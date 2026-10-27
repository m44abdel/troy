import { describe, expect, it } from 'vitest'
import { applyOrder, moveTo } from './order'

describe('applyOrder', () => {
  it('unsaved items go last', () => {
    expect(applyOrder(['a', 'b', 'c', 'd'], ['c', 'a'], (x) => x)).toEqual(['c', 'a', 'b', 'd'])
  })
})

describe('moveTo', () => {
  it('moves forwards and backwards', () => {
    expect(moveTo(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd'])
    expect(moveTo(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
  })

  it('no-op cases', () => {
    expect(moveTo(['a', 'b'], 'a', 'a')).toEqual(['a', 'b'])
    expect(moveTo(['a', 'b'], 'x', 'a')).toEqual(['a', 'b'])
  })
})
