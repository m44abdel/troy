// Agent-to-agent messages and spawn requests. The MCP server (a separate process per agent)
// drops a file into the mail folder; Troy watches it and types each message into the
// receiving agent, or creates the worktree a spawn asks for.
import { randomUUID } from 'crypto'
import { mkdirSync, readdirSync, watch } from 'fs'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type { Mail, SpawnRequest } from '../shared/types'

export type { Mail, SpawnRequest }

const MAX_TEXT = 8000
const SWEEP_MS = 2000

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

/** Writes atomically, so the watcher never reads half a file. */
async function drop(dir: string, item: object): Promise<void> {
  await mkdir(dir, { recursive: true })
  const name = `${Date.now()}-${randomUUID()}`
  const body = JSON.stringify({ ...item, sentAt: new Date().toISOString() })
  await writeFile(join(dir, `${name}.tmp`), body)
  await rename(join(dir, `${name}.tmp`), join(dir, `${name}.json`))
}

function checkText(text: string, what: string): void {
  if (!text.trim()) throw new Error(`The ${what} is empty.`)
  if (text.length > MAX_TEXT) throw new Error(`Keep the ${what} under ${MAX_TEXT} characters.`)
}

export async function sendMail(dir: string, mail: Omit<Mail, 'sentAt'>): Promise<void> {
  checkText(mail.text, 'message')
  await drop(dir, mail)
}

// Spawns sit in a subfolder: the mail watcher only takes .json files, so it never sees them.
export const spawnDir = (mailDir: string): string => join(mailDir, 'spawn')

export function parseSpawn(raw: string): SpawnRequest | null {
  try {
    const m = JSON.parse(raw)
    const ok =
      typeof m?.from === 'string' &&
      typeof m.repo === 'string' &&
      typeof m.branch === 'string' &&
      m.branch.trim() &&
      typeof m.prompt === 'string' &&
      m.prompt.trim() &&
      m.prompt.length <= MAX_TEXT &&
      (m.agent === null || typeof m.agent === 'string') &&
      typeof m.sentAt === 'string'
    return ok ? m : null
  } catch {
    return null
  }
}

export async function requestSpawn(
  mailDir: string,
  req: Omit<SpawnRequest, 'sentAt'>
): Promise<void> {
  if (!req.branch.trim()) throw new Error('The branch is empty.')
  checkText(req.prompt, 'prompt')
  await drop(spawnDir(mailDir), req)
}

export const watchMail = (dir: string, onMail: (mail: Mail) => void): (() => void) =>
  watchFolder(dir, parseMail, onMail)

export const watchSpawns = (mailDir: string, onSpawn: (req: SpawnRequest) => void): (() => void) =>
  watchFolder(spawnDir(mailDir), parseSpawn, onSpawn)

/** Hands each file (including ones waiting from before) to onItem once, then deletes it. */
function watchFolder<T>(
  dir: string,
  parse: (raw: string) => T | null,
  onItem: (item: T) => void
): () => void {
  mkdirSync(dir, { recursive: true })
  const taken = new Set<string>()
  const take = async (file: string): Promise<void> => {
    if (!file.endsWith('.json') || taken.has(file)) return
    taken.add(file)
    const path = join(dir, file)
    const raw = await readFile(path, 'utf8').catch(() => null)
    await rm(path, { force: true })
    const item = raw === null ? null : parse(raw)
    if (item) onItem(item)
    else if (raw !== null) console.warn(`Dropped an unreadable file: ${path}`)
  }
  // One at a time, in the order found, so files arrive in the order they were sent.
  // Files already waiting are queued first: watch events only fire after this returns.
  let queue = Promise.resolve()
  const enqueue = (file: string): void => {
    queue = queue.then(() => take(file))
  }
  const sweep = (): void => readdirSync(dir).sort().forEach(enqueue)
  const watcher = watch(dir, (_event, file) => file && enqueue(file))
  sweep()
  // ponytail: macOS can deliver watch events late or drop them under load; a slow rescan
  // makes sure no message is lost. Taken files are skipped, so nothing arrives twice.
  const backstop = setInterval(sweep, SWEEP_MS)
  return () => {
    watcher.close()
    clearInterval(backstop)
  }
}
