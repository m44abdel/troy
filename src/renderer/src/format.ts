const MINUTE = 60_000

/** Time left, e.g. "3h 43m" until Claude's usage window resets; null once it has passed. */
export function countdown(ms: number): string | null {
  if (ms < 0) return null
  const minutes = Math.floor(ms / MINUTE)
  if (minutes < 1) return '<1m'
  const h = Math.floor(minutes / 60)
  return h ? `${h}h ${minutes % 60}m` : `${minutes}m`
}

export const memory = (mb: number): string =>
  mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb} MB`
