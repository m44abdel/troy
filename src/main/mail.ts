// Agent-to-agent messages. The MCP server (a separate process per agent) drops a file into
// the mail folder; Troy watches it and types each message into the receiving agent.
import { randomUUID } from 'crypto'
import { mkdirSync, readdirSync, watch } from 'fs'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type { Mail } from '../shared/types'

export type { Mail }

const MAX_TEXT = 8000

export function parseMail(raw: string): Mail | null {
  try {
    const m = JSON.parse(raw)
    const ok =
      typeof m?.from === 'string' &&
      typeof m.to === 'string' &&
      typeof m.text === 'string' &&
      m.text.trim() &&
      m.text.length <= MAX_TEXT &&
      typeof m.sentAt === 'string' &&
      (m.fromBranch === null || typeof m.fromBranch === 'string')
    return ok ? m : null
  } catch {
    return null
  }
}

/** Writes atomically, so the watcher never reads half a message. */
export async function sendMail(dir: string, mail: Omit<Mail, 'sentAt'>): Promise<void> {
  if (!mail.text.trim()) throw new Error('The message is empty.')
  if (mail.text.length > MAX_TEXT) throw new Error(`Keep messages under ${MAX_TEXT} characters.`)
  await mkdir(dir, { recursive: true })
  const name = `${Date.now()}-${randomUUID()}`
  const body = JSON.stringify({ ...mail, sentAt: new Date().toISOString() })
  await writeFile(join(dir, `${name}.tmp`), body)
  await rename(join(dir, `${name}.tmp`), join(dir, `${name}.json`))
}

/** Hands each message (including ones waiting from before) to onMail once, then deletes it. */
export function watchMail(dir: string, onMail: (mail: Mail) => void): () => void {
  mkdirSync(dir, { recursive: true })
  const taken = new Set<string>()
  const take = async (file: string): Promise<void> => {
    if (!file.endsWith('.json') || taken.has(file)) return
    taken.add(file)
    const path = join(dir, file)
    const raw = await readFile(path, 'utf8').catch(() => null)
    await rm(path, { force: true })
    const mail = raw === null ? null : parseMail(raw)
    if (mail) onMail(mail)
    else if (raw !== null) console.warn(`Dropped an unreadable message: ${file}`)
  }
  const watcher = watch(dir, (_event, file) => file && void take(file))
  readdirSync(dir)
    .sort()
    .forEach((file) => void take(file))
  return () => watcher.close()
}
