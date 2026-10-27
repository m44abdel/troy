import { describe, expect, it } from 'vitest'
import {
  isPaneNode,
  layout,
  leaf,
  leaves,
  remove,
  setRatio,
  split,
  step,
  type PaneNode
} from './panes'

// a | (b over c)
const threePanes = (): PaneNode => split(split(leaf('a'), 'a', 'row', 'b'), 'b', 'column', 'c')

describe('split', () => {
  it('puts the new pane right of the target, half and half', () => {
    expect(split(leaf('a'), 'a', 'row', 'b')).toEqual({
      kind: 'split',
      dir: 'row',
      ratio: 0.5,
      a: leaf('a'),
      b: leaf('b')
    })
  })

  it('splits a pane deep in the tree and leaves the rest alone', () => {
    expect(leaves(threePanes())).toEqual(['a', 'b', 'c'])
    const root = threePanes()
    expect(root.kind === 'split' && root.b).toMatchObject({ kind: 'split', dir: 'column' })
  })

  it('returns the tree unchanged when the target is not in it', () => {
    const root = leaf('a')
    expect(split(root, 'zz', 'row', 'b')).toBe(root)
  })
})

describe('remove', () => {
  it('collapses the parent split into the sibling', () => {
    expect(remove(threePanes(), 'c')).toEqual(split(leaf('a'), 'a', 'row', 'b'))
    expect(remove(threePanes(), 'a')).toEqual(split(leaf('b'), 'b', 'column', 'c'))
  })

  it('removing the last pane leaves nothing', () => {
    expect(remove(leaf('a'), 'a')).toBeNull()
  })
})

describe('step', () => {
  it('moves through panes in tree order and wraps at either end', () => {
    expect(step(threePanes(), 'a', 1)).toBe('b')
    expect(step(threePanes(), 'c', 1)).toBe('a')
    expect(step(threePanes(), 'a', -1)).toBe('c')
  })
})

describe('setRatio', () => {
  it('resizes the split at a path', () => {
    const root = setRatio(threePanes(), 'b', 0.3)
    expect(root.kind === 'split' && root.b.kind === 'split' && root.b.ratio).toBe(0.3)
  })

  it('keeps both sides at least a tenth wide', () => {
    expect(setRatio(leafPair(), '', 0.01)).toMatchObject({ ratio: 0.1 })
    expect(setRatio(leafPair(), '', 2)).toMatchObject({ ratio: 0.9 })
  })
})

const leafPair = (): PaneNode => split(leaf('a'), 'a', 'row', 'b')

describe('layout', () => {
  it('places every pane as a percentage of the tab', () => {
    expect(layout(threePanes()).rects).toEqual({
      a: { x: 0, y: 0, w: 50, h: 100 },
      b: { x: 50, y: 0, w: 50, h: 50 },
      c: { x: 50, y: 50, w: 50, h: 50 }
    })
  })

  it('has one divider per split, inside that split', () => {
    expect(layout(threePanes()).dividers).toEqual([
      { path: '', dir: 'row', box: { x: 0, y: 0, w: 100, h: 100 }, ratio: 0.5 },
      { path: 'b', dir: 'column', box: { x: 50, y: 0, w: 50, h: 100 }, ratio: 0.5 }
    ])
  })
})

describe('isPaneNode', () => {
  it('accepts a stored tree and rejects junk', () => {
    expect(isPaneNode(JSON.parse(JSON.stringify(threePanes())))).toBe(true)
    expect(isPaneNode({ kind: 'split', dir: 'row', ratio: 0.5, a: leaf('a') })).toBe(false)
    expect(isPaneNode({ kind: 'leaf' })).toBe(false)
    expect(isPaneNode(null)).toBe(false)
  })
})
