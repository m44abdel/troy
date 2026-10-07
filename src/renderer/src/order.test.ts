import { describe, expect, it } from 'vitest'
import { applyOrder, moveTo } from './order'

describe('applyOrder', () => {
  it('sorts by the saved order and keeps unknown items after, in their own order', () => {
    expect(applyOrder(['a', 'b', 'c', 'd'], ['c', 'a'], (x) => x)).toEqual(['c', 'a', 'b', 'd'])
  })
})

describe('moveTo', () => {
  it('moves an item onto another position, either direction', () => {
    expect(moveTo(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd'])
    expect(moveTo(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
  })

  it('leaves the list alone for unknown items or a move onto itself', () => {
    expect(moveTo(['a', 'b'], 'a', 'a')).toEqual(['a', 'b'])
    expect(moveTo(['a', 'b'], 'x', 'a')).toEqual(['a', 'b'])
  })
})
