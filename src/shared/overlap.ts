export interface Overlap {
  other: string
  files: string[]
}

/** For each worktree, the other worktrees that changed some of the same files. */
export function overlaps(changes: Record<string, string[]>): Record<string, Overlap[]> {
  const entries = Object.entries(changes)
  // ponytail: pairwise scan; fine for the handful of worktrees a person runs at once.
  return Object.fromEntries(
    entries.flatMap(([path, files]) => {
      const found = entries.flatMap(([other, theirs]) => {
        const shared = other === path ? [] : files.filter((f) => theirs.includes(f))
        return shared.length ? [{ other, files: shared }] : []
      })
      return found.length ? [[path, found]] : []
    })
  )
}
