import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readClaudeLog, readCodexLog, scanSessions } from './sessions'

const jsonl = (...entries: object[]): string => entries.map((e) => JSON.stringify(e)).join('\n')
const user = (content: unknown, extra: object = {}): object => ({
  type: 'user',
  cwd: '/work/shop',
  message: { role: 'user', content },
  ...extra
})
const assistant = (text: string): object => ({
  type: 'assistant',
  cwd: '/work/shop',
  message: { role: 'assistant', content: [{ type: 'text', text }] }
})

describe('readClaudeLog', () => {
  it('counts the conversation and keeps its last line', () => {
    const log = jsonl(
      user('<local-command-caveat>ignore me</local-command-caveat>', { isMeta: true }),
      user('Round the cart totals'),
      assistant('Done, totals round to the cent.'),
      user([{ type: 'tool_result', content: 'ok' }]),
      user([{ type: 'text', text: 'Thanks' }])
    )
    expect(readClaudeLog(log)).toEqual({
      cwd: '/work/shop',
      title: 'Round the cart totals',
      preview: { who: 'you', text: 'Thanks' },
      messages: 3
    })
  })

  it('prefers a name given to the session over the first prompt', () => {
    const base = [user('Fix it'), assistant('Fixed.')]
    expect(readClaudeLog(jsonl(...base, { type: 'ai-title', aiTitle: 'Login fix' })).title).toBe(
      'Login fix'
    )
    expect(
      readClaudeLog(
        jsonl(
          ...base,
          { type: 'ai-title', aiTitle: 'Login fix' },
          {
            type: 'agent-name',
            agentName: 'fix-login'
          }
        )
      ).title
    ).toBe('fix-login')
    expect(
      readClaudeLog(
        jsonl(
          ...base,
          { type: 'agent-name', agentName: 'fix-login' },
          {
            type: 'custom-title',
            customTitle: 'My login fix'
          }
        )
      ).title
    ).toBe('My login fix')
  })

  it('counts a reply that ended in a tool call', () => {
    const reply = assistant('Let me look.')
    const log = jsonl(user('Go'), {
      ...reply,
      message: { ...(reply as { message: object }).message, stop_reason: 'tool_use' }
    })
    expect(readClaudeLog(log)).toMatchObject({ messages: 2 })
  })

  it('counts a huge pasted message without reading it', () => {
    const log = jsonl(user('Look at this'), user('x'.repeat(300 * 1024)))
    expect(readClaudeLog(log)).toMatchObject({
      messages: 2,
      preview: { who: 'you', text: 'Look at this' }
    })
  })

  it("leaves out a subagent's own turns", () => {
    const log = jsonl(user('Go'), { ...assistant('side work'), isSidechain: true })
    expect(readClaudeLog(log)).toMatchObject({ messages: 1, preview: { who: 'you', text: 'Go' } })
  })
})

describe('readCodexLog', () => {
  it('reads the session id, folder and messages', () => {
    const log = jsonl(
      { type: 'session_meta', payload: { id: 'abc-1', cwd: '/work/shop' } },
      { type: 'event_msg', payload: { type: 'user_message', message: '<system>x</system>' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'Add a test' } },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'Added one.' } }
    )
    expect(readCodexLog(log)).toEqual({
      id: 'abc-1',
      cwd: '/work/shop',
      title: 'Add a test',
      preview: { who: 'agent', text: 'Added one.' },
      messages: 2
    })
  })
})

describe('scanSessions', () => {
  it('finds Claude Code sessions with their subagents, newest first', async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'troy-sessions-')))
    const project = join(home, 'claude', 'projects', '-work-shop')
    mkdirSync(join(project, 'old-1', 'subagents'), { recursive: true })
    writeFileSync(join(project, 'old-1.jsonl'), jsonl(user('First task'), assistant('ok')))
    writeFileSync(join(project, 'old-1', 'subagents', 'agent-a.jsonl'), '')
    writeFileSync(join(project, 'new-2.jsonl'), jsonl(user('Second task')))
    writeFileSync(join(project, 'empty-3.jsonl'), '')
    utimesSync(join(project, 'old-1.jsonl'), 1000, 1000)

    const { sessions, scanned } = await scanSessions({
      claudeHome: join(home, 'claude'),
      codexHome: join(home, 'codex'),
      cacheFile: join(home, 'cache.json')
    })

    expect(scanned).toBe(3)
    expect(sessions.map((s) => [s.id, s.title, s.subagents])).toEqual([
      ['new-2', 'Second task', 0],
      ['old-1', 'First task', 1]
    ])
    expect(sessions[1]).toMatchObject({ agent: 'claude', cwd: '/work/shop', updatedAt: 1_000_000 })
  })

  it('starts over when the cache file is cut short', async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'troy-sessions-')))
    const project = join(home, 'claude', 'projects', '-work-shop')
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, 'a-1.jsonl'), jsonl(user('Task')))
    writeFileSync(join(home, 'cache.json'), '{"half":')

    const { sessions } = await scanSessions({
      claudeHome: join(home, 'claude'),
      codexHome: join(home, 'codex'),
      cacheFile: join(home, 'cache.json')
    })

    expect(sessions.map((s) => s.id)).toEqual(['a-1'])
  })
})
