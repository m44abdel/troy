import { describe, expect, it } from 'vitest'
import { leaf, leaves, split } from '../../shared/panes'
import {
  AGENT_TAB,
  activeTab,
  closePane,
  closeTab,
  focusPane,
  initialTabs,
  isTabs,
  openPreview,
  openTab,
  splitPane,
  stepPane,
  stepTab,
  toggleZoom,
  type Tabs
} from './tabs'

const shellTab = (id: string): Parameters<typeof openTab>[1] => ({
  id,
  title: id,
  root: leaf(`${id}-pane`),
  focus: `${id}-pane`
})

// The agent tab plus two shell tabs, the last one active.
const threeTabs = (): Tabs => openTab(openTab(initialTabs('agent'), shellTab('t1')), shellTab('t2'))

describe('initialTabs', () => {
  it('starts with the agent alone in its tab', () => {
    expect(initialTabs('agent')).toEqual({
      list: [{ id: AGENT_TAB, title: 'Agent', root: leaf('agent'), focus: 'agent' }],
      active: AGENT_TAB
    })
  })

  it('puts the setup shell to the right of the agent', () => {
    const tab = activeTab(initialTabs('agent', 'setup'))
    expect(tab.root).toEqual(split(leaf('agent'), 'agent', 'row', 'setup'))
    expect(tab.focus).toBe('agent')
  })
})

describe('splitPane', () => {
  it('splits the focused pane and focuses the new one', () => {
    const tab = activeTab(splitPane(initialTabs('agent'), 'column', 'shell'))
    expect(tab.root).toEqual(split(leaf('agent'), 'agent', 'column', 'shell'))
    expect(tab.focus).toBe('shell')
  })

  it('leaves zoom, so the new pane is visible', () => {
    const zoomed = toggleZoom(splitPane(initialTabs('agent'), 'row', 'shell'))
    expect(activeTab(splitPane(zoomed, 'row', 'third')).zoomed).toBeUndefined()
  })
})

describe('closePane', () => {
  it('drops the pane and focuses the one that took its place', () => {
    const tabs = focusPane(splitPane(splitPane(initialTabs('agent'), 'row', 'b'), 'row', 'c'), 'b')
    const tab = activeTab(closePane(tabs, 'b'))
    expect(leaves(tab.root)).toEqual(['agent', 'c'])
    expect(tab.focus).toBe('c')
  })

  it('closes the tab with its last pane', () => {
    const tabs = closePane(threeTabs(), 't2-pane')
    expect(tabs.list.map((t) => t.id)).toEqual([AGENT_TAB, 't1'])
    expect(tabs.active).toBe('t1')
  })
})

describe('closeTab', () => {
  it('activates the tab that slides into its place, or the one before at the end', () => {
    const middle = closeTab(focusPane(threeTabs(), 't1-pane'), 't1')
    expect(middle.active).toBe('t2')
    expect(closeTab(threeTabs(), 't2').active).toBe('t1')
  })

  it('keeps the active tab when another one closes', () => {
    expect(closeTab(threeTabs(), 't1').active).toBe('t2')
  })
})

describe('stepping', () => {
  it('steps through tabs and wraps', () => {
    expect(stepTab(threeTabs(), 1).active).toBe(AGENT_TAB)
    expect(stepTab(threeTabs(), -1).active).toBe('t1')
  })

  it('steps through the panes of the active tab', () => {
    const tabs = splitPane(initialTabs('agent'), 'row', 'shell')
    expect(activeTab(stepPane(tabs, 1)).focus).toBe('agent')
  })

  it('focusing a pane activates its tab', () => {
    const tabs = focusPane(threeTabs(), 'agent')
    expect(tabs.active).toBe(AGENT_TAB)
    expect(activeTab(tabs).focus).toBe('agent')
  })
})

describe('toggleZoom', () => {
  it('zooms the focused pane and back', () => {
    const tabs = splitPane(initialTabs('agent'), 'row', 'shell')
    expect(activeTab(toggleZoom(tabs)).zoomed).toBe('shell')
    expect(activeTab(toggleZoom(toggleZoom(tabs))).zoomed).toBeUndefined()
  })
})

describe('openPreview', () => {
  it('opens a file in a tab of its own', () => {
    const tabs = openPreview(initialTabs('agent'), 'p1', 'src/app.ts', 3)
    expect(activeTab(tabs)).toMatchObject({
      id: 'p1',
      title: 'app.ts',
      preview: { file: 'src/app.ts', line: 3 }
    })
  })

  it('goes back to the tab a file is already open in, at the new line', () => {
    const once = openPreview(initialTabs('agent'), 'p1', 'src/app.ts')
    const twice = openPreview(stepTab(once, 1), 'p2', 'src/app.ts', 9)
    expect(twice.list.map((t) => t.id)).toEqual([AGENT_TAB, 'p1'])
    expect(activeTab(twice).preview).toEqual({ file: 'src/app.ts', line: 9 })
  })
})

describe('isTabs', () => {
  it('accepts stored tabs and rejects junk', () => {
    expect(isTabs(JSON.parse(JSON.stringify(threeTabs())))).toBe(true)
    expect(isTabs({ list: [], active: AGENT_TAB })).toBe(false)
    expect(isTabs({ list: [{ id: 'x' }], active: 'x' })).toBe(false)
    expect(isTabs({ list: threeTabs().list, active: 'gone' })).toBe(false)
  })
})
