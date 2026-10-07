/** Items in the saved order; items it doesn't mention follow, in their original order. */
export function applyOrder<T>(items: T[], order: string[], key: (item: T) => string): T[] {
  const rank = (item: T): number => {
    const i = order.indexOf(key(item))
    return i === -1 ? Infinity : i
  }
  return [...items].sort((a, b) => rank(a) - rank(b))
}

/** Moves `from` to where `to` is, shifting the items between. */
export function moveTo(list: string[], from: string, to: string): string[] {
  const i = list.indexOf(from)
  const j = list.indexOf(to)
  if (i === -1 || j === -1 || i === j) return list
  const next = list.filter((x) => x !== from)
  next.splice(j, 0, from)
  return next
}
