// ponytail: five-field cron (minute hour day-of-month month day-of-week) with *, lists,
// ranges and steps; no names (MON, JAN) or @daily. Swap for cron-parser if those are wanted.

const FIELDS = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7 }
] as const

function parseField(text: string, { min, max }: { min: number; max: number }): Set<number> {
  const values = new Set<number>()
  for (const part of text.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part)
    if (!m) throw new Error(`Can't read "${part}"`)
    const from = m[1] === '*' ? min : Number(m[2])
    const to = m[1] === '*' ? max : m[3] !== undefined ? Number(m[3]) : m[4] ? max : from
    const step = m[4] ? Number(m[4]) : 1
    if (from < min || to > max || from > to || step < 1)
      throw new Error(`"${part}" is outside ${min}-${max}`)
    for (let v = from; v <= to; v += step) values.add(v)
  }
  return values
}

/** Throws a readable error for a bad expression; returns a matcher for a good one. */
export function parseCron(expr: string): (date: Date) => boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5)
    throw new Error('A schedule has five fields: minute hour day-of-month month day-of-week')
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, FIELDS[i]))
  // Sunday is 0 or 7, as in crontab.
  if (dow.has(7)) dow.add(0)
  const anyDom = parts[2] === '*'
  const anyDow = parts[4] === '*'
  return (d) => {
    const domOk = dom.has(d.getDate())
    const dowOk = dow.has(d.getDay())
    // Like crontab: when both day fields are restricted, either one matching is enough.
    const dayOk = anyDom || anyDow ? domOk && dowOk : domOk || dowOk
    return (
      minute.has(d.getMinutes()) && hour.has(d.getHours()) && month.has(d.getMonth() + 1) && dayOk
    )
  }
}
