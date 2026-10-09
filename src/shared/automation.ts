import { parseCron } from './cron'
import type { Automation } from './types'

const MAX_PROMPT = 8000

/** Checks an automation from disk or the form; throws a message fit to show. */
export function parseAutomation(raw: unknown): Automation {
  const a = (raw ?? {}) as Record<string, unknown>
  const text = (key: string): string => {
    const v = a[key]
    if (typeof v !== 'string' || !v.trim()) throw new Error(`The ${key} is missing.`)
    return v.trim()
  }
  const automation = {
    id: text('id'),
    name: text('name'),
    repo: text('repo'),
    schedule: text('schedule'),
    agent: text('agent'),
    prompt: text('prompt')
  }
  if (/[\r\n]/.test(automation.agent)) throw new Error('The agent must be one command line.')
  if (automation.prompt.length > MAX_PROMPT)
    throw new Error(`Keep the prompt under ${MAX_PROMPT} characters.`)
  parseCron(automation.schedule)
  return automation
}

/** The automations whose schedule matches this minute. */
export const dueAt = (automations: Automation[], now: Date): Automation[] =>
  automations.filter((a) => parseCron(a.schedule)(now))

const pad = (n: number): string => String(n).padStart(2, '0')

/** Each run gets its own branch, named for the automation and the minute it started. */
export function runBranch(name: string, now: Date): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'run'
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `auto/${slug}-${stamp}`
}
