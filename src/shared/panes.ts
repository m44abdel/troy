// The panes of a terminal tab: a binary tree of splits, like Orca's. 'row' puts the second
// pane to the right of the first, 'column' puts it underneath.

export type SplitDir = 'row' | 'column'

export type PaneNode =
  | { kind: 'leaf'; id: string }
  | { kind: 'split'; dir: SplitDir; ratio: number; a: PaneNode; b: PaneNode }

/** A box in percent of the whole tab. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** The divider of the split at `path` ('a'/'b' steps from the root), drawn inside `box`. */
export interface Divider {
  path: string
  dir: SplitDir
  box: Rect
  ratio: number
}

const MIN_RATIO = 0.1
const MAX_RATIO = 0.9

export const leaf = (id: string): PaneNode => ({ kind: 'leaf', id })

export function leaves(node: PaneNode): string[] {
  return node.kind === 'leaf' ? [node.id] : [...leaves(node.a), ...leaves(node.b)]
}

/** Replaces the pane `target` with a split of it and a new pane `id`. */
export function split(root: PaneNode, target: string, dir: SplitDir, id: string): PaneNode {
  if (root.kind === 'leaf')
    return root.id === target ? { kind: 'split', dir, ratio: 0.5, a: root, b: leaf(id) } : root
  const a = split(root.a, target, dir, id)
  const b = a === root.a ? split(root.b, target, dir, id) : root.b
  return a === root.a && b === root.b ? root : { ...root, a, b }
}

/** Drops a pane; its sibling takes the parent's place. null once the last pane goes. */
export function remove(root: PaneNode, id: string): PaneNode | null {
  if (root.kind === 'leaf') return root.id === id ? null : root
  const a = remove(root.a, id)
  const b = remove(root.b, id)
  if (!a) return b
  if (!b) return a
  return a === root.a && b === root.b ? root : { ...root, a, b }
}

/** The pane `by` places from `id` in tree order, wrapping at either end. */
export function step(root: PaneNode, id: string, by: number): string {
  const all = leaves(root)
  const i = Math.max(0, all.indexOf(id))
  return all[(i + by + all.length * Math.abs(by)) % all.length]
}

export function setRatio(root: PaneNode, path: string, ratio: number): PaneNode {
  if (root.kind === 'leaf') return root
  if (!path) return { ...root, ratio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)) }
  const side = path[0] as 'a' | 'b'
  return { ...root, [side]: setRatio(root[side], path.slice(1), ratio) }
}

function place(
  node: PaneNode,
  box: Rect,
  path: string,
  out: { rects: Record<string, Rect>; dividers: Divider[] }
): void {
  if (node.kind === 'leaf') {
    out.rects[node.id] = box
    return
  }
  out.dividers.push({ path, dir: node.dir, box, ratio: node.ratio })
  const first =
    node.dir === 'row' ? { ...box, w: box.w * node.ratio } : { ...box, h: box.h * node.ratio }
  const second =
    node.dir === 'row'
      ? { ...box, x: box.x + first.w, w: box.w - first.w }
      : { ...box, y: box.y + first.h, h: box.h - first.h }
  place(node.a, first, `${path}a`, out)
  place(node.b, second, `${path}b`, out)
}

/** Where each pane and divider goes, so every pane can render flat and keep its terminal alive. */
export function layout(root: PaneNode): { rects: Record<string, Rect>; dividers: Divider[] } {
  const out = { rects: {}, dividers: [] }
  place(root, { x: 0, y: 0, w: 100, h: 100 }, '', out)
  return out
}

export function isPaneNode(v: unknown): v is PaneNode {
  if (typeof v !== 'object' || v === null) return false
  const node = v as Record<string, unknown>
  if (node.kind === 'leaf') return typeof node.id === 'string'
  return (
    node.kind === 'split' &&
    (node.dir === 'row' || node.dir === 'column') &&
    typeof node.ratio === 'number' &&
    isPaneNode(node.a) &&
    isPaneNode(node.b)
  )
}
