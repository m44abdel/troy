const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MONTH = 30 * DAY

/** "just now", "5m ago", "3h ago", "13d ago", then the date. */
export function timeAgo(at: number, now = Date.now()): string {
  const ms = now - at
  if (ms < MINUTE) return 'just now'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m ago`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`
  if (ms < MONTH) return `${Math.floor(ms / DAY)}d ago`
  return new Date(at).toLocaleDateString()
}
