/**
 * How another worktree's changes meet this one's: `same` files changed, this one `uses`
 * code the other changed, or the other uses code this one changed (`usedBy`).
 */
export type OverlapKind = 'same' | 'uses' | 'usedBy'

export interface Overlap {
  other: string
  kind: OverlapKind
  /** This worktree's files involved. */
  files: string[]
}

function between(
  mine: string[],
  theirs: string[],
  deps: Record<string, string[]>
): Array<Omit<Overlap, 'other'>> {
  const same = mine.filter((f) => theirs.includes(f))
  // A shared file says more than a dependency, so it stands alone.
  if (same.length) return [{ kind: 'same', files: same }]
  const uses = mine.filter((f) => deps[f]?.some((d) => theirs.includes(d)))
  const usedBy = mine.filter((f) => theirs.some((t) => deps[t]?.includes(f)))
  return [
    ...(uses.length ? [{ kind: 'uses' as const, files: uses }] : []),
    ...(usedBy.length ? [{ kind: 'usedBy' as const, files: usedBy }] : [])
  ]
}

/**
 * For each worktree, the others whose changes meet its own. `deps` maps a file to the
 * files its code imports or calls; without it only same-file overlaps are found.
 */
export function overlaps(
  changes: Record<string, string[]>,
  deps: Record<string, string[]> = {}
): Record<string, Overlap[]> {
  const entries = Object.entries(changes)
  // ponytail: pairwise scan; fine for the handful of worktrees a person runs at once.
  return Object.fromEntries(
    entries.flatMap(([path, files]) => {
      const found = entries.flatMap(([other, theirs]) =>
        other === path ? [] : between(files, theirs, deps).map((o) => ({ other, ...o }))
      )
      return found.length ? [[path, found]] : []
    })
  )
}
