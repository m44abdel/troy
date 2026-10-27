import { app, ipcMain } from 'electron'
import { createReadStream } from 'fs'
import { glob, readdir, readFile, stat, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { createInterface } from 'readline'
import type { SessionSummary } from '../shared/types'
import { claudeHome, codexHome } from './context'
import { attempt } from './repos'

const MAX_TEXT = 200
// Ids go into a resume command typed into a shell, so only plain ones are listed.
const SESSION_ID = /^[\w-]+$/

type Preview = SessionSummary['preview']
type LogSummary = Pick<SessionSummary, 'title' | 'preview' | 'messages'> & { cwd?: string }

interface Sources {
  claudeHome: string
  codexHome: string
  cacheFile: string
}

const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)

// Lines that start with a tag are the CLI talking (command echoes, caveats), not you.
const isPrompt = (text: string): boolean => !!text && !text.startsWith('<')

/** Folds a log one line at a time, so a log of hundreds of MB never sits in memory whole. */
interface LogReader<T> {
  add: (line: string) => void
  done: () => T
}

// Picks the lines worth parsing by their "type". Tool calls, tool results, thinking and the
// API request copies are most of a log's bytes and say nothing a person typed or read.
const picker =
  (wanted: string[], skipped: string[] = []) =>
  (line: string): boolean =>
    wanted.some((w) => line.includes(w)) && !skipped.some((s) => line.includes(s))

// Longer lines are pasted logs or screenshots: they count as a message without being parsed,
// which would stall the main process.
const MAX_PARSED_LINE = 256 * 1024

function parse(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line)
  } catch {
    // A log still being written can end in half a line.
    return null
  }
}

/** The text of a Claude Code message, or '' for tool calls, tool results and thinking. */
function claudeText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content) || content.some((c) => c?.type === 'tool_result')) return ''
  return content
    .filter((c) => c?.type === 'text')
    .map((c) => c.text)
    .join(' ')
}

const NAMES = ['custom-title', 'agent-name', 'ai-title'] as const

function claudeReader(): LogReader<LogSummary> {
  const wanted = picker(
    ['user', 'assistant', ...NAMES].map((t) => `"type":"${t}"`),
    ['"type":"tool_result"', '"type":"tool_use"', '"type":"thinking"', '"isSidechain":true']
  )
  const names: Record<string, string> = {}
  let cwd: string | undefined
  let firstPrompt = ''
  let preview: Preview = null
  let messages = 0
  const add = (line: string): void => {
    if (!wanted(line)) return
    if (line.length > MAX_PARSED_LINE) {
      if (!line.includes('"isMeta":true')) messages++
      return
    }
    const e = parse(line)
    if (!e) return
    if (NAMES.includes(e.type as (typeof NAMES)[number])) {
      names[e.type as string] = String(e.customTitle ?? e.agentName ?? e.aiTitle ?? '')
      return
    }
    if ((e.type !== 'user' && e.type !== 'assistant') || e.isSidechain || e.isMeta) return
    cwd ??= typeof e.cwd === 'string' ? e.cwd : undefined
    const said = tidy(claudeText((e.message as { content?: unknown } | undefined)?.content))
    if (!isPrompt(said)) return
    messages++
    preview = { who: e.type === 'user' ? 'you' : 'agent', text: said }
    if (e.type === 'user') firstPrompt ||= said
  }
  const done = (): LogSummary => {
    const title = names['custom-title'] || names['agent-name'] || names['ai-title'] || firstPrompt
    return { cwd, title: tidy(title), preview, messages }
  }
  return { add, done }
}

function codexReader(): LogReader<LogSummary & { id?: string }> {
  const wanted = picker(
    ['session_meta', 'user_message', 'agent_message'].map((t) => `"type":"${t}"`)
  )
  let id: string | undefined
  let cwd: string | undefined
  let title = ''
  let preview: Preview = null
  let messages = 0
  const add = (line: string): void => {
    const e = wanted(line) ? parse(line) : null
    const p = (e?.payload ?? {}) as Record<string, unknown>
    if (e?.type === 'session_meta') {
      id = String(p.id ?? '')
      cwd = typeof p.cwd === 'string' ? p.cwd : undefined
      return
    }
    const said = tidy(String(p.message ?? ''))
    if (!isPrompt(said) || (p.type !== 'user_message' && p.type !== 'agent_message')) return
    messages++
    preview = { who: p.type === 'user_message' ? 'you' : 'agent', text: said }
    if (p.type === 'user_message') title ||= said
  }
  return { add, done: () => ({ id, cwd, title, preview, messages }) }
}

const readAll = <T>(reader: LogReader<T>, text: string): T => {
  text.split('\n').forEach(reader.add)
  return reader.done()
}

export const readClaudeLog = (text: string): LogSummary => readAll(claudeReader(), text)
export const readCodexLog = (text: string): LogSummary & { id?: string } =>
  readAll(codexReader(), text)

async function readFileLines<T>(file: string, reader: LogReader<T>): Promise<T> {
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  for await (const line of lines) reader.add(line)
  return reader.done()
}

async function subagentCount(log: string): Promise<number> {
  const dir = join(dirname(log), basename(log, '.jsonl'), 'subagents')
  const files = await readdir(dir).catch(() => [] as string[])
  return files.filter((f) => f.endsWith('.jsonl')).length
}

async function summarize(
  file: string,
  agent: SessionSummary['agent'],
  updatedAt: number
): Promise<SessionSummary | null> {
  const log = await readFileLines<LogSummary & { id?: string }>(
    file,
    agent === 'claude' ? claudeReader() : codexReader()
  )
  const id = agent === 'claude' ? basename(file, '.jsonl') : (log as { id?: string }).id
  if (!id || !SESSION_ID.test(id) || !log.cwd || !log.messages) return null
  const subagents = agent === 'claude' ? await subagentCount(file) : 0
  return {
    id,
    agent,
    cwd: log.cwd,
    title: log.title,
    preview: log.preview,
    messages: log.messages,
    subagents,
    updatedAt
  }
}

async function logFiles({
  claudeHome,
  codexHome
}: Sources): Promise<Array<[string, SessionSummary['agent']]>> {
  const found: Array<[string, SessionSummary['agent']]> = []
  const projects = join(claudeHome, 'projects')
  for (const dir of await readdir(projects).catch(() => [] as string[]))
    for (const f of await readdir(join(projects, dir)).catch(() => [] as string[]))
      if (f.endsWith('.jsonl')) found.push([join(projects, dir, f), 'claude'])
  const rollouts = join(codexHome, 'sessions')
  for await (const f of glob('**/rollout-*.jsonl', { cwd: rollouts }))
    found.push([join(rollouts, f), 'codex'])
  return found
}

type Cache = Record<string, { key: string; summary: SessionSummary | null }>

const loadCache = async (file: string): Promise<Cache> =>
  JSON.parse(await readFile(file, 'utf8').catch(() => '{}'))

/** Every session in the agents' logs. Only logs that changed since the last scan are read. */
export async function scanSessions(
  sources: Sources
): Promise<{ sessions: SessionSummary[]; scanned: number }> {
  const before = await loadCache(sources.cacheFile)
  const after: Cache = {}
  const files = await logFiles(sources)
  for (const [file, agent] of files) {
    const info = await stat(file).catch(() => null)
    if (!info) continue
    const key = `${info.mtimeMs}:${info.size}`
    const summary =
      before[file]?.key === key
        ? before[file].summary
        : await summarize(file, agent, info.mtimeMs).catch(() => null)
    after[file] = { key, summary }
  }
  await writeFile(sources.cacheFile, JSON.stringify(after))
  const sessions = Object.values(after)
    .map((c) => c.summary)
    .filter((s): s is SessionSummary => s !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return { sessions, scanned: files.length }
}

export function registerSessions(): void {
  // Panes ask together when several worktrees are open; they share one scan.
  let scanning: ReturnType<typeof scanSessions> | null = null
  ipcMain.handle('sessions:list', () =>
    attempt(() => {
      scanning ??= scanSessions({
        claudeHome: claudeHome(),
        codexHome: codexHome(),
        cacheFile: join(app.getPath('userData'), 'sessions-cache.json')
      }).finally(() => (scanning = null))
      return scanning
    })
  )
}
