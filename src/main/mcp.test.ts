import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { formatEntry, readKnowledge } from './knowledge'
import { createServer, search } from './mcp'
import { hookFlags, hookSettings, mcpFlags } from './mcp-config'

function tempRepo(): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'troy-mcp-')))
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  writeFileSync(join(repo, 'a.ts'), 'one\ntwo\n')
  execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.'])
  execFileSync('git', [
    '-C',
    repo,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-qm',
    'i'
  ])
  return repo
}

const call = (id: number, name: string, args: object): object => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: args }
})

describe('MCP server', () => {
  it('handshakes, lists both tools and ignores notifications', async () => {
    const handle = createServer(tempRepo())
    const init = await handle({
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', clientInfo: { name: 'claude-code' } }
    })
    expect(init).toMatchObject({
      id: 1,
      result: { protocolVersion: '2025-03-26', serverInfo: { name: 'troy' } }
    })
    expect(await handle({ method: 'notifications/initialized' })).toBeNull()

    const list = (await handle({ id: 2, method: 'tools/list' })) as {
      result: { tools: { name: string }[] }
    }
    expect(list.result.tools.map((t) => t.name)).toEqual(['knowledge_search', 'knowledge_propose'])
    expect(await handle({ id: 3, method: 'resources/list' })).toMatchObject({
      error: { code: -32601 }
    })
  })

  it('queues proposals under the client name and reports bad sources to the agent', async () => {
    const repo = tempRepo()
    const handle = createServer(repo)
    await handle({ id: 1, method: 'initialize', params: { clientInfo: { name: 'codex' } } })

    const ok = await handle(
      call(2, 'knowledge_propose', { fact: 'Two is line 2.', source: 'a.ts:2' })
    )
    expect(JSON.stringify(ok)).toContain('Queued for review')
    const bad = await handle(call(3, 'knowledge_propose', { fact: 'x', source: 'a.ts:9' }))
    expect(bad).toMatchObject({ result: { isError: true } })

    const { proposals } = await readKnowledge(repo)
    expect(proposals.map((p) => [p.fact, p.author])).toEqual([['Two is line 2.', 'codex']])
  })

  it('searches approved facts only and marks stale ones', async () => {
    const repo = tempRepo()
    mkdirSync(join(repo, '.troy'))
    const fact = {
      fact: 'Ports start at 3100.',
      source: 'a.ts:1',
      date: '2026-01-01',
      author: 'me'
    }
    writeFileSync(join(repo, '.troy', 'knowledge.md'), formatEntry(fact))
    const handle = createServer(repo)

    const hit = JSON.stringify(await handle(call(1, 'knowledge_search', { query: 'PORTS 3100' })))
    expect(hit).toContain('Ports start at 3100.')
    expect(hit).toContain('STALE')
    const miss = JSON.stringify(await handle(call(2, 'knowledge_search', { query: 'database' })))
    expect(miss).toContain('No approved facts match')
  })
})

describe('search', () => {
  it('needs every word, in the fact or its source', () => {
    const e = {
      fact: 'Retries stop at 3',
      source: 'src/api.ts:4',
      date: '',
      author: '',
      stale: false
    }
    expect(search([e], '')).toEqual([e])
    expect(search([e], 'retries api.ts')).toEqual([e])
    expect(search([e], 'retries db')).toEqual([])
  })
})

describe('mcpFlags', () => {
  const server = {
    command: '/Apps/Troy',
    args: ['/x/mcp-server.js'],
    env: { ELECTRON_RUN_AS_NODE: '1' }
  }

  it('points Claude at the config file and gives Codex inline TOML overrides', () => {
    expect(mcpFlags('claude --resume', "/it's/mcp.json", server)).toBe(
      ` --mcp-config '/it'\\''s/mcp.json'`
    )
    expect(mcpFlags('/bin/codex', '', server)).toBe(
      ` -c 'mcp_servers.troy.command="/Apps/Troy"'` +
        ` -c 'mcp_servers.troy.args=["/x/mcp-server.js"]'` +
        ` -c 'mcp_servers.troy.env={ELECTRON_RUN_AS_NODE="1"}'`
    )
    expect(mcpFlags('aider', '', server)).toBe('')
  })
})

describe('hookSettings', () => {
  const commandFor = (event: string): string =>
    (hookSettings().hooks as Record<string, { hooks: { command: string }[] }[]>)[event][0].hooks[0]
      .command

  it('writes the status OSC to the tty named by TROY_TTY', () => {
    const tty = join(mkdtempSync(join(tmpdir(), 'troy-hook-')), 'tty')
    writeFileSync(tty, '')
    execFileSync('sh', ['-c', commandFor('Stop')], { env: { ...process.env, TROY_TTY: tty } })
    expect(readFileSync(tty, 'utf8')).toBe('\x1b]7700;waiting\x07')
    execFileSync('sh', ['-c', commandFor('UserPromptSubmit')], {
      env: { ...process.env, TROY_TTY: tty }
    })
    expect(readFileSync(tty, 'utf8')).toBe('\x1b]7700;running\x07')
  })

  it('succeeds silently outside Troy', () => {
    const env = { ...process.env }
    delete env.TROY_TTY
    expect(execFileSync('sh', ['-c', commandFor('Notification')], { env }).toString()).toBe('')
  })
})

describe('hookFlags', () => {
  it('loads the hook settings into Claude only', () => {
    expect(hookFlags('claude', "/it's/hooks.json")).toBe(` --settings '/it'\\''s/hooks.json'`)
    expect(hookFlags('codex', '/x')).toBe('')
  })
})
