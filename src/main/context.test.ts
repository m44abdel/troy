import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  claudeProjectDir,
  claudeUsage,
  codexSessionCwd,
  codexUsage,
  readContext,
  resumeFlag
} from './context'

const jsonl = (...entries: object[]): string => entries.map((e) => JSON.stringify(e)).join('\n')

const assistant = (input: number, cacheRead: number, cacheCreate: number, extra = {}): object => ({
  type: 'assistant',
  isSidechain: false,
  message: {
    model: 'claude-opus-5-5',
    usage: {
      input_tokens: input,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheCreate,
      output_tokens: 999
    }
  },
  ...extra
})

const modelAttachment = (modelId: string): object => ({
  type: 'attachment',
  attachment: { type: 'model', identity: { modelId } }
})

describe('claudeUsage', () => {
  it('sums input and cache tokens of the last main-thread assistant turn', () => {
    const log = jsonl(
      modelAttachment('claude-opus-5-5'),
      assistant(1, 1000, 10),
      assistant(2, 50_000, 300),
      assistant(5, 90_000, 0, { isSidechain: true })
    )
    expect(claudeUsage(log)).toEqual({ used: 50_302, window: 200_000, model: 'claude-opus-5-5' })
  })

  it('uses the 1M window when the model attachment says so or usage proves it', () => {
    expect(
      claudeUsage(jsonl(modelAttachment('claude-opus-5-5[1m]'), assistant(1, 10, 0)))?.window
    ).toBe(1_000_000)
    expect(claudeUsage(jsonl(assistant(0, 240_000, 0)))?.window).toBe(1_000_000)
  })

  it('skips synthetic turns, tolerates a cut-off first line and returns null without usage', () => {
    const synthetic = {
      ...assistant(0, 0, 0),
      message: { model: '<synthetic>', usage: { input_tokens: 0 } }
    }
    const log = '{"type":"assistant","cut' + '\n' + jsonl(assistant(1, 100, 0), synthetic)
    expect(claudeUsage(log)?.used).toBe(101)
    expect(claudeUsage(jsonl({ type: 'user' }))).toBeNull()
  })
})

const tokenCount = (total: number, window: number | null): object => ({
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: {
      last_token_usage: { total_tokens: total },
      total_token_usage: { total_tokens: 1e9 },
      model_context_window: window
    }
  }
})

describe('codexUsage', () => {
  it('takes the latest token_count with a known window', () => {
    const log = jsonl(tokenCount(10_000, 272_000), tokenCount(54_000, 272_000), {
      type: 'event_msg',
      payload: { type: 'token_count', info: null }
    })
    expect(codexUsage(log)).toEqual({ used: 54_000, window: 272_000, model: null })
    expect(codexUsage(jsonl(tokenCount(5, null)))).toBeNull()
  })

  it('reads the session cwd even when the first line is truncated', () => {
    const head =
      '{"type":"session_meta","payload":{"id":"x","cwd":"/a/b \\"q\\"","base_instructions":{"text":"You are'
    expect(codexSessionCwd(head)).toBe('/a/b "q"')
  })
})

describe('readContext', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'troy-ctx-'))
    process.env.CLAUDE_CONFIG_DIR = join(home, 'claude')
    process.env.CODEX_HOME = join(home, 'codex')
  })
  afterEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR
    delete process.env.CODEX_HOME
  })

  it('finds the newest Claude session for the worktree path', async () => {
    const dir = claudeProjectDir('/code/app.feat-x')
    expect(dir).toBe(join(home, 'claude', 'projects', '-code-app-feat-x'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'old.jsonl'), jsonl(assistant(0, 1, 0)))
    await new Promise((r) => setTimeout(r, 20))
    writeFileSync(join(dir, 'new.jsonl'), jsonl(assistant(0, 42_000, 0)))

    expect((await readContext('/code/app.feat-x', 'claude --resume'))?.used).toBe(42_000)
  })

  it('matches Codex sessions by cwd and knows nothing about other agents', async () => {
    const day = join(home, 'codex', 'sessions', '2026', '10', '06')
    mkdirSync(day, { recursive: true })
    const meta = (cwd: string): object => ({ type: 'session_meta', payload: { cwd } })
    writeFileSync(
      join(day, 'rollout-a.jsonl'),
      jsonl(meta('/code/app'), tokenCount(7_000, 100_000))
    )
    writeFileSync(
      join(day, 'rollout-b.jsonl'),
      jsonl(meta('/elsewhere'), tokenCount(9_000, 100_000))
    )

    expect((await readContext('/code/app', '/opt/bin/codex'))?.used).toBe(7_000)
    expect(await readContext('/code/app', 'aider')).toBeNull()
    expect(await readContext('/nowhere', 'claude')).toBeNull()
  })
})

describe('resumeFlag', () => {
  it('continues Claude in a worktree that has a conversation, and nothing else', () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'troy-claude-')))
    const old = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = home
    try {
      const used = '/code/app.feat-x'
      mkdirSync(join(home, 'projects', '-code-app-feat-x'), { recursive: true })
      writeFileSync(join(home, 'projects', '-code-app-feat-x', 'abc.jsonl'), '{}\n')
      mkdirSync(join(home, 'projects', '-code-app-empty'), { recursive: true })

      expect(resumeFlag('claude', used)).toBe(' --continue')
      expect(resumeFlag('/usr/local/bin/claude --model opus', used)).toBe(' --continue')
      expect(resumeFlag('claude', '/code/app.empty')).toBe('')
      expect(resumeFlag('claude', '/code/app.fresh')).toBe('')
      expect(resumeFlag('aider', used)).toBe('')
    } finally {
      if (old === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = old
    }
  })
})
