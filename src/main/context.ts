import { readdirSync } from 'fs'
import { glob, open, readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { commandName } from '../shared/shell'
import type { ContextUsage } from '../shared/types'

// ponytail: only the end of each log is read; the usage we need is always recent.
const TAIL_BYTES = 2 * 1024 * 1024
const CLAUDE_WINDOW = 200_000
const CLAUDE_1M_WINDOW = 1_000_000

const claudeHome = (): string => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
const codexHome = (): string => process.env.CODEX_HOME || join(homedir(), '.codex')

/** Claude Code names a project's log folder after its path, every other character a dash. */
export const claudeProjectDir = (path: string): string =>
  join(claudeHome(), 'projects', path.replace(/[^a-zA-Z0-9]/g, '-'))

/** The fields Troy reads from Claude Code and Codex session logs. */
interface LogEntry {
  type?: string
  isSidechain?: boolean
  message?: { model?: string; usage?: Record<string, number> }
  attachment?: { type?: string; identity?: { modelId?: string } }
  payload?: {
    type?: string
    info?: {
      last_token_usage?: { total_tokens: number }
      model_context_window?: number | null
    } | null
  }
}

function* jsonLinesFromEnd(text: string, mustContain: string[]): Generator<LogEntry> {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!mustContain.some((s) => lines[i].includes(s))) continue
    try {
      yield JSON.parse(lines[i])
    } catch {
      // The first line of a tail read is usually cut in half.
    }
  }
}

export function claudeUsage(jsonl: string): ContextUsage | null {
  let used: number | null = null
  let model: string | null = null
  let modelId: string | null = null
  for (const entry of jsonLinesFromEnd(jsonl, ['"assistant"', '"model"'])) {
    const usage = entry.message?.usage
    if (used === null && entry.type === 'assistant' && !entry.isSidechain && usage) {
      if (entry.message?.model === '<synthetic>') continue
      used =
        (usage.input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0)
      model = entry.message?.model ?? null
    }
    if (entry.type === 'attachment' && entry.attachment?.type === 'model') {
      modelId = entry.attachment.identity?.modelId ?? null
      break
    }
  }
  if (used === null) return null
  // Only the model attachment says "[1m]"; without it, usage past 200k proves the larger window.
  const isLarge = modelId?.includes('[1m]') || used > CLAUDE_WINDOW
  return { used, window: isLarge ? CLAUDE_1M_WINDOW : CLAUDE_WINDOW, model: modelId ?? model }
}

export function codexUsage(jsonl: string): ContextUsage | null {
  for (const entry of jsonLinesFromEnd(jsonl, ['"token_count"'])) {
    const info = entry.payload?.type === 'token_count' ? entry.payload.info : null
    if (!info?.last_token_usage || !info.model_context_window) continue
    return {
      used: info.last_token_usage.total_tokens,
      window: info.model_context_window,
      model: null
    }
  }
  return null
}

// The session_meta line embeds the whole system prompt, so it may not fit in the
// head read; cwd comes before it.
export function codexSessionCwd(head: string): string | null {
  const match = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(head.split('\n')[0])
  return match ? JSON.parse(`"${match[1]}"`) : null
}

async function readTail(file: string): Promise<string> {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    const start = Math.max(0, size - TAIL_BYTES)
    const buffer = Buffer.alloc(size - start)
    await handle.read(buffer, 0, buffer.length, start)
    return buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}

async function readHead(file: string, bytes = 64 * 1024): Promise<string> {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
    return buffer.toString('utf8', 0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function newest(files: string[]): Promise<string[]> {
  const stamped = await Promise.all(
    files.map(async (f) => ({ f, t: (await stat(f).catch(() => null))?.mtimeMs ?? 0 }))
  )
  return stamped.sort((a, b) => b.t - a.t).map((s) => s.f)
}

async function claudeContext(path: string): Promise<ContextUsage | null> {
  const dir = claudeProjectDir(path)
  const files = (await readdir(dir).catch(() => [] as string[]))
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => join(dir, f))
  const [latest] = await newest(files)
  return latest ? claudeUsage(await readTail(latest)) : null
}

// ponytail: stats every rollout file on each poll; index by cwd if ~/.codex/sessions grows huge.
async function codexContext(path: string): Promise<ContextUsage | null> {
  const files: string[] = []
  for await (const f of glob('**/rollout-*.jsonl', { cwd: join(codexHome(), 'sessions') }))
    files.push(join(codexHome(), 'sessions', f))
  for (const file of await newest(files)) {
    if (codexSessionCwd(await readHead(file)) === path) return codexUsage(await readTail(file))
  }
  return null
}

/** Context-window usage of the agent's latest session in `path`, or null when unknown. */
export async function readContext(path: string, agent: string): Promise<ContextUsage | null> {
  const cli = commandName(agent)
  if (cli === 'claude') return claudeContext(path)
  if (cli === 'codex') return codexContext(path)
  return null
}

/**
 * What to add to the agent's command line to pick up where it left off in this worktree.
 * Claude's --continue takes the latest conversation in the current folder, which is this
 * worktree's. Empty when there is nothing to continue, since --continue would then fail.
 */
// ponytail: Claude only; add Codex once its resume command is verified here.
export function resumeFlag(agent: string, path: string): string {
  if (commandName(agent) !== 'claude') return ''
  try {
    return readdirSync(claudeProjectDir(path)).some((f) => f.endsWith('.jsonl'))
      ? ' --continue'
      : ''
  } catch {
    return ''
  }
}
