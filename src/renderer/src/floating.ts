import { clamp } from './clamp'
import { successor } from './tabs'

/** A tab of the floating window: a shell in the home folder, or a note from the notes folder. */
export interface FloatTab {
  id: string
  kind: 'terminal' | 'note'
  title: string
  /** The note's file name in the notes folder. */
  note?: string
}

/** `active` is null while the menu shows, e.g. after + or once the last tab closes. */
export interface FloatTabs {
  list: FloatTab[]
  active: string | null
}

export const NO_TABS: FloatTabs = { list: [], active: null }

export interface Point {
  x: number
  y: number
}

export interface Size {
  w: number
  h: number
}

export type FloatRect = Point & Size

/** A spot kept as its gap to the nearest corner, so it stays in that corner as the window resizes. */
export interface Anchored extends Point {
  right: boolean
  bottom: boolean
}

// The floating window has the keyboard from when it opens, or is clicked, until it closes or
// a click lands behind it. While it does, the tab and pane shortcuts are its own.
let hasKeys = false

export const floatingHasKeys = (): boolean => hasKeys

export const giveFloatingKeys = (yes: boolean): void => {
  hasKeys = yes
}

export const activeFloatTab = (tabs: FloatTabs): FloatTab | undefined =>
  tabs.list.find((t) => t.id === tabs.active)

export const openTab = (tabs: FloatTabs, tab: FloatTab): FloatTabs => ({
  list: [...tabs.list, tab],
  active: tab.id
})

/** Opens `note` in a new tab, or goes back to the one it is already open in. */
export function openNote(tabs: FloatTabs, id: string, note: string): FloatTabs {
  const open = tabs.list.find((t) => t.note === note)
  if (open) return { ...tabs, active: open.id }
  return openTab(tabs, { id, kind: 'note', title: note.replace(/\.md$/, ''), note })
}

export function closeTab(tabs: FloatTabs, id: string): FloatTabs {
  const list = tabs.list.filter((t) => t.id !== id)
  if (tabs.active !== id) return { ...tabs, list }
  return {
    list,
    active:
      successor(
        tabs.list.map((t) => t.id),
        id
      ) ?? null
  }
}

/** Steps through the tabs, wrapping; from the menu it goes to the first or last one. */
export function stepTab(tabs: FloatTabs, by: number): FloatTabs {
  const n = tabs.list.length
  if (!n) return tabs
  const i = tabs.list.findIndex((t) => t.id === tabs.active)
  const from = i < 0 ? (by > 0 ? -1 : 0) : i
  return { ...tabs, active: tabs.list[(((from + by) % n) + n) % n].id }
}

const isFloatTab = (v: unknown): v is FloatTab => {
  if (typeof v !== 'object' || v === null) return false
  const tab = v as Record<string, unknown>
  return (
    typeof tab.id === 'string' &&
    typeof tab.title === 'string' &&
    (tab.kind === 'terminal' || (tab.kind === 'note' && typeof tab.note === 'string'))
  )
}

export const isFloatTabs = (v: unknown): v is FloatTabs => {
  if (typeof v !== 'object' || v === null) return false
  const { list, active } = v as Record<string, unknown>
  return (
    Array.isArray(list) &&
    list.every(isFloatTab) &&
    (active === null || list.some((t: FloatTab) => t.id === active))
  )
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export const isAnchored = (v: unknown): v is Anchored => {
  if (typeof v !== 'object' || v === null) return false
  const a = v as Record<string, unknown>
  return (
    isFiniteNumber(a.x) &&
    isFiniteNumber(a.y) &&
    typeof a.right === 'boolean' &&
    typeof a.bottom === 'boolean'
  )
}

export const isRect = (v: unknown): v is FloatRect => {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return [r.x, r.y, r.w, r.h].every(isFiniteNumber)
}

/** The corner nearest the middle of a `size` box at `p`, and the box's gap to it. */
export function anchor(p: Point, size: Size, viewport: Size): Anchored {
  const right = p.x + size.w / 2 > viewport.w / 2
  const bottom = p.y + size.h / 2 > viewport.h / 2
  return {
    x: right ? viewport.w - p.x - size.w : p.x,
    y: bottom ? viewport.h - p.y - size.h : p.y,
    right,
    bottom
  }
}

/** Moves a `size` box at `p` the least it takes to sit inside `viewport`. */
export const inside = (p: Point, size: Size, viewport: Size): Point => ({
  x: clamp(p.x, { min: 0, max: Math.max(0, viewport.w - size.w) }),
  y: clamp(p.y, { min: 0, max: Math.max(0, viewport.h - size.h) })
})

/** Where an anchored `size` box sits in `viewport`, kept inside it. */
export const place = (a: Anchored, size: Size, viewport: Size): Point =>
  inside(
    {
      x: a.right ? viewport.w - a.x - size.w : a.x,
      y: a.bottom ? viewport.h - a.y - size.h : a.y
    },
    size,
    viewport
  )

/** Keeps the window inside the viewport, shrinking it to fit, but never below `min`. */
export function fitRect(rect: FloatRect, viewport: Size, min: Size): FloatRect {
  const w = clamp(rect.w, { min: min.w, max: Math.max(min.w, viewport.w) })
  const h = clamp(rect.h, { min: min.h, max: Math.max(min.h, viewport.h) })
  return {
    x: clamp(rect.x, { min: 0, max: Math.max(0, viewport.w - w) }),
    y: clamp(rect.y, { min: 0, max: Math.max(0, viewport.h - h) }),
    w,
    h
  }
}

const OPEN_SHARE = 0.7

/** Where the window first opens: the middle of the viewport, 70% of its size. */
export function centered(viewport: Size, min: Size): FloatRect {
  const w = Math.max(min.w, Math.round(viewport.w * OPEN_SHARE))
  const h = Math.max(min.h, Math.round(viewport.h * OPEN_SHARE))
  return fitRect(
    { x: Math.round((viewport.w - w) / 2), y: Math.round((viewport.h - h) / 2), w, h },
    viewport,
    min
  )
}
