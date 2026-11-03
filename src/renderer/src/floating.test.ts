import { describe, expect, it } from 'vitest'
import {
  NO_TABS,
  anchor,
  centered,
  closeTab,
  fitRect,
  isAnchored,
  isFloatTabs,
  isRect,
  openNote,
  openTab,
  place,
  stepTab,
  type FloatTab,
  type FloatTabs
} from './floating'

const terminal = (id: string): FloatTab => ({ id, kind: 'terminal', title: id })

const threeTabs = (): FloatTabs =>
  openTab(openTab(openTab(NO_TABS, terminal('a')), terminal('b')), terminal('c'))

describe('openTab', () => {
  it('appends the tab and makes it active', () => {
    const tabs = openTab(NO_TABS, terminal('a'))
    expect(tabs).toEqual({ list: [terminal('a')], active: 'a' })
  })
})

describe('openNote', () => {
  it('opens a note in a tab titled without its extension', () => {
    const tabs = openNote(NO_TABS, 'n1', 'Ideas.md')
    expect(tabs.list).toEqual([{ id: 'n1', kind: 'note', title: 'Ideas', note: 'Ideas.md' }])
    expect(tabs.active).toBe('n1')
  })

  it('goes back to the tab a note is already open in', () => {
    const tabs = openNote(
      openTab(openNote(NO_TABS, 'n1', 'Ideas.md'), terminal('a')),
      'n2',
      'Ideas.md'
    )
    expect(tabs.list.map((t) => t.id)).toEqual(['n1', 'a'])
    expect(tabs.active).toBe('n1')
  })
})

describe('closeTab', () => {
  it('activates the tab that slides into the closed one’s place', () => {
    const tabs = closeTab({ ...threeTabs(), active: 'b' }, 'b')
    expect(tabs).toEqual({ list: [terminal('a'), terminal('c')], active: 'c' })
  })

  it('activates the one before when the last tab closes', () => {
    expect(closeTab(threeTabs(), 'c').active).toBe('b')
  })

  it('keeps the active tab when another one closes', () => {
    expect(closeTab(threeTabs(), 'a').active).toBe('c')
  })

  it('shows the menu once no tab is left', () => {
    expect(closeTab(openTab(NO_TABS, terminal('a')), 'a')).toEqual(NO_TABS)
  })
})

describe('stepTab', () => {
  it('wraps at either end', () => {
    expect(stepTab(threeTabs(), 1).active).toBe('a')
    expect(stepTab({ ...threeTabs(), active: 'a' }, -1).active).toBe('c')
  })

  it('steps from the menu to the first or last tab', () => {
    const menu = { ...threeTabs(), active: null }
    expect(stepTab(menu, 1).active).toBe('a')
    expect(stepTab(menu, -1).active).toBe('c')
  })

  it('stays on the menu with no tabs', () => {
    expect(stepTab(NO_TABS, 1)).toEqual(NO_TABS)
  })
})

describe('isFloatTabs', () => {
  it('accepts saved tabs and the empty menu', () => {
    expect(isFloatTabs(threeTabs())).toBe(true)
    expect(isFloatTabs(NO_TABS)).toBe(true)
  })

  it('rejects an active id that is not in the list', () => {
    expect(isFloatTabs({ ...threeTabs(), active: 'gone' })).toBe(false)
  })

  it('rejects a note tab without its file', () => {
    expect(isFloatTabs({ list: [{ id: 'n', kind: 'note', title: 'n' }], active: 'n' })).toBe(false)
  })

  it('rejects junk', () => {
    expect(isFloatTabs(null)).toBe(false)
    expect(isFloatTabs({ list: [{ id: 1 }], active: null })).toBe(false)
  })
})

const BUTTON = { w: 36, h: 36 }

describe('anchor and place', () => {
  it('give back the same point in the same viewport', () => {
    const viewport = { w: 1000, h: 800 }
    const point = { x: 900, y: 50 }
    expect(place(anchor(point, BUTTON, viewport), BUTTON, viewport)).toEqual(point)
  })

  it('keep a bottom-right button the same distance from its corner when the window grows', () => {
    const at = anchor({ x: 950, y: 740 }, BUTTON, { w: 1000, h: 800 })
    expect(at).toEqual({ x: 14, y: 24, right: true, bottom: true })
    expect(place(at, BUTTON, { w: 1600, h: 1000 })).toEqual({ x: 1550, y: 940 })
  })

  it('keep a top-left button where it is when the window grows', () => {
    const at = anchor({ x: 20, y: 30 }, BUTTON, { w: 1000, h: 800 })
    expect(place(at, BUTTON, { w: 1600, h: 1000 })).toEqual({ x: 20, y: 30 })
  })

  it('keep the button inside a window too small for its gap', () => {
    const at = { x: 500, y: 500, right: false, bottom: false }
    expect(place(at, BUTTON, { w: 300, h: 200 })).toEqual({ x: 264, y: 164 })
  })

  it('isAnchored spots junk', () => {
    expect(isAnchored({ x: 1, y: 2, right: true, bottom: false })).toBe(true)
    expect(isAnchored({ x: 1, y: 2 })).toBe(false)
    expect(isAnchored({ x: Number.NaN, y: 2, right: true, bottom: false })).toBe(false)
  })
})

const MIN = { w: 360, h: 240 }

describe('fitRect', () => {
  it('leaves a window that fits alone', () => {
    const rect = { x: 100, y: 100, w: 500, h: 400 }
    expect(fitRect(rect, { w: 1000, h: 800 }, MIN)).toEqual(rect)
  })

  it('pulls a window back inside the viewport', () => {
    const rect = { x: 900, y: -50, w: 500, h: 400 }
    expect(fitRect(rect, { w: 1000, h: 800 }, MIN)).toEqual({ x: 500, y: 0, w: 500, h: 400 })
  })

  it('shrinks a window larger than the viewport, but not below its minimum', () => {
    expect(fitRect({ x: 0, y: 0, w: 2000, h: 2000 }, { w: 1000, h: 800 }, MIN)).toEqual({
      x: 0,
      y: 0,
      w: 1000,
      h: 800
    })
    expect(fitRect({ x: 0, y: 0, w: 10, h: 10 }, { w: 1000, h: 800 }, MIN)).toEqual({
      x: 0,
      y: 0,
      w: 360,
      h: 240
    })
  })

  it('centered opens the window in the middle, at most 70% of the viewport', () => {
    expect(centered({ w: 1000, h: 800 }, MIN)).toEqual({ x: 150, y: 120, w: 700, h: 560 })
  })

  it('isRect spots junk', () => {
    expect(isRect({ x: 1, y: 2, w: 3, h: 4 })).toBe(true)
    expect(isRect({ x: 1, y: 2, w: '3', h: 4 })).toBe(false)
  })
})
