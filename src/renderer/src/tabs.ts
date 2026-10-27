import {
  isPaneNode,
  leaf,
  leaves,
  remove,
  setRatio,
  split,
  step,
  type PaneNode,
  type SplitDir
} from '../../shared/panes'

/** The agent's tab is always first and closes only with the session. */
export const AGENT_TAB = 'agent'

export interface Tab {
  id: string
  title: string
  root: PaneNode
  focus: string
  zoomed?: string
  /** Panes that run a command instead of a plain shell, e.g. a resumed session. */
  commands?: Record<string, string>
  /** A read-only file view instead of terminals. */
  preview?: { file: string; line?: number }
}

export interface Tabs {
  list: Tab[]
  active: string
}

export function initialTabs(agent: string, setupPane?: string): Tabs {
  const root = setupPane ? split(leaf(agent), agent, 'row', setupPane) : leaf(agent)
  return { list: [{ id: AGENT_TAB, title: 'Agent', root, focus: agent }], active: AGENT_TAB }
}

export const activeTab = (tabs: Tabs): Tab =>
  tabs.list.find((t) => t.id === tabs.active) ?? tabs.list[0]

const withTab = (tabs: Tabs, id: string, change: (tab: Tab) => Tab): Tabs => ({
  ...tabs,
  list: tabs.list.map((t) => (t.id === id ? change(t) : t))
})

const withActive = (tabs: Tabs, change: (tab: Tab) => Tab): Tabs =>
  withTab(tabs, activeTab(tabs).id, change)

// The item that slides into the place of the one removed, or the one before it at the end.
const successor = <T>(list: T[], gone: T): T | undefined => {
  const rest = list.filter((x) => x !== gone)
  return rest[Math.min(list.indexOf(gone), rest.length - 1)]
}

export const openTab = (tabs: Tabs, tab: Tab): Tabs => ({
  list: [...tabs.list, tab],
  active: tab.id
})

/** Opens `file` in a preview tab, or goes back to the one it is already open in. */
export function openPreview(tabs: Tabs, id: string, file: string, line?: number): Tabs {
  const open = tabs.list.find((t) => t.preview?.file === file)
  if (open)
    return {
      ...withTab(tabs, open.id, (t) => ({ ...t, preview: { file, line } })),
      active: open.id
    }
  const title = file.split('/').pop() ?? file
  return openTab(tabs, { id, title, root: leaf(id), focus: id, preview: { file, line } })
}

export function closeTab(tabs: Tabs, id: string): Tabs {
  const list = tabs.list.filter((t) => t.id !== id)
  if (tabs.active !== id) return { ...tabs, list }
  const ids = tabs.list.map((t) => t.id)
  return { list, active: successor(ids, id) ?? AGENT_TAB }
}

export const splitPane = (tabs: Tabs, dir: SplitDir, pane: string): Tabs =>
  withActive(tabs, (tab) => ({
    ...tab,
    root: split(tab.root, tab.focus, dir, pane),
    focus: pane,
    zoomed: undefined
  }))

export const tabOf = (tabs: Tabs, pane: string): Tab | undefined =>
  tabs.list.find((t) => leaves(t.root).includes(pane))

export function closePane(tabs: Tabs, pane: string): Tabs {
  const tab = tabOf(tabs, pane)
  if (!tab) return tabs
  const root = remove(tab.root, pane)
  if (!root) return closeTab(tabs, tab.id)
  const focus =
    tab.focus === pane ? (successor(leaves(tab.root), pane) ?? leaves(root)[0]) : tab.focus
  return withTab(tabs, tab.id, (t) => ({
    ...t,
    root,
    focus,
    zoomed: t.zoomed === pane ? undefined : t.zoomed
  }))
}

export function focusPane(tabs: Tabs, pane: string): Tabs {
  const tab = tabOf(tabs, pane)
  if (!tab) return tabs
  return { ...withTab(tabs, tab.id, (t) => ({ ...t, focus: pane })), active: tab.id }
}

export const stepPane = (tabs: Tabs, by: number): Tabs =>
  withActive(tabs, (tab) => ({ ...tab, focus: step(tab.root, tab.focus, by), zoomed: undefined }))

export function stepTab(tabs: Tabs, by: number): Tabs {
  const i = tabs.list.indexOf(activeTab(tabs))
  const n = tabs.list.length
  return { ...tabs, active: tabs.list[(i + by + n) % n].id }
}

export const toggleZoom = (tabs: Tabs): Tabs =>
  withActive(tabs, (tab) => ({ ...tab, zoomed: tab.zoomed ? undefined : tab.focus }))

export const resizeSplit = (tabs: Tabs, id: string, path: string, ratio: number): Tabs =>
  withTab(tabs, id, (tab) => ({ ...tab, root: setRatio(tab.root, path, ratio) }))

function isTab(v: unknown): v is Tab {
  if (typeof v !== 'object' || v === null) return false
  const tab = v as Record<string, unknown>
  return (
    typeof tab.id === 'string' &&
    typeof tab.title === 'string' &&
    typeof tab.focus === 'string' &&
    isPaneNode(tab.root) &&
    (tab.preview === undefined || typeof (tab.preview as Tab['preview'])?.file === 'string')
  )
}

export const isTabs = (v: unknown): v is Tabs => {
  if (typeof v !== 'object' || v === null) return false
  const { list, active } = v as Record<string, unknown>
  return (
    Array.isArray(list) &&
    list.length > 0 &&
    list.every(isTab) &&
    list.some((t: Tab) => t.id === active)
  )
}
