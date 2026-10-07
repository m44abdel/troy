// Troy's MCP server: lets any agent search approved knowledge and propose new facts.
// ponytail: hand-rolled JSON-RPC for the three methods it needs; the official SDK
// brings an HTTP stack (express, hono) Troy never uses.
import type { KnowledgeEntry } from '../shared/types'
import { formatEntry, propose, readKnowledge, SOURCE_HELP } from './knowledge'
import { sendMail } from './mail'
import { listWorktrees } from './worktrees'

const PROTOCOL_VERSION = '2025-06-18'

const TOOLS = [
  {
    name: 'knowledge_search',
    description:
      "Search this repository's approved knowledge (.troy/knowledge.md). Every fact cites a source; entries marked STALE cite a file that changed since, so re-check them.",
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Words that must all appear. Empty lists everything.'
        }
      }
    }
  },
  {
    name: 'knowledge_propose',
    description:
      'Propose a fact for the shared knowledge. Only propose what you verified at the source. A person approves it before any agent sees it.',
    inputSchema: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'One self-contained sentence.' },
        source: { type: 'string', description: `Where it can be checked: ${SOURCE_HELP}.` }
      },
      required: ['fact', 'source']
    }
  },
  {
    name: 'agents_list',
    description:
      "List this repository's worktrees. Each runs its own agent in Troy; agent_message reaches them by branch.",
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'agent_message',
    description:
      "Send a message to the agent working in another worktree of this repository, e.g. to say you are changing code it depends on. It is typed into that agent's session (or waits until it runs), labelled as from you, with how to reply.",
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: "The other worktree's branch (see agents_list) or path."
        },
        text: { type: 'string', description: 'The message. Be specific and brief.' }
      },
      required: ['to', 'text']
    }
  }
]

interface Message {
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

type Entry = KnowledgeEntry & { stale: boolean }

export function search(entries: Entry[], query: string): Entry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter((e) => {
    const text = `${e.fact} ${e.source}`.toLowerCase()
    return words.every((w) => text.includes(w))
  })
}

const describe = (e: Entry): string =>
  formatEntry(e).trimEnd() +
  (e.stale ? `\n  STALE: ${e.source} changed after ${e.date}; re-check before relying on it.` : '')

const text = (s: string, isError = false): object => ({
  content: [{ type: 'text', text: s }],
  ...(isError ? { isError } : {})
})

/** Handles one JSON-RPC message; returns the reply, or null for notifications. */
export function createServer(
  cwd: string,
  /** Troy's mail folder; without it (outside Troy) agents can't message each other. */
  mailDir?: string
): (msg: Message) => Promise<object | null> {
  let client = 'unknown'

  async function message(args: Record<string, unknown>): Promise<object> {
    if (!mailDir) return text('Messaging other agents only works inside Troy.', true)
    if (typeof args.to !== 'string' || typeof args.text !== 'string')
      return text('to and text must be strings.', true)
    const worktrees = await listWorktrees(cwd)
    const me = worktrees.find((w) => w.path === cwd)
    const target = worktrees.find((w) => w.branch === args.to || w.path === args.to)
    if (!target) return text(`No worktree "${args.to}". Call agents_list to see them.`, true)
    if (target.path === cwd) return text('That is your own worktree.', true)
    await sendMail(mailDir, {
      from: cwd,
      fromBranch: me?.branch ?? null,
      to: target.path,
      text: args.text
    })
    return text(
      `Sent to ${target.branch ?? target.path}. It arrives now if that agent is running, otherwise when it starts.`
    )
  }

  async function callTool(name: unknown, args: Record<string, unknown>): Promise<object> {
    if (name === 'agents_list') {
      const lines = (await listWorktrees(cwd)).map(
        (w) => `${w.branch ?? 'detached'} — ${w.path}${w.path === cwd ? ' (you)' : ''}`
      )
      return text(lines.join('\n'))
    }
    if (name === 'agent_message') return message(args)
    if (name === 'knowledge_search') {
      const { entries } = await readKnowledge(cwd)
      const query = typeof args.query === 'string' ? args.query : ''
      const hits = search(entries, query)
      if (!hits.length)
        return text(`No approved facts match "${query}" (${entries.length} in total).`)
      return text(hits.map(describe).join('\n'))
    }
    if (name === 'knowledge_propose') {
      if (typeof args.fact !== 'string' || typeof args.source !== 'string')
        return text('fact and source must be strings.', true)
      await propose(cwd, { fact: args.fact, source: args.source, author: client })
      return text('Queued for review. It joins the shared knowledge once a person approves it.')
    }
    return text(`Unknown tool: ${String(name)}`, true)
  }

  async function result(method: string, params: Record<string, unknown>): Promise<object> {
    if (method === 'initialize') {
      const info = params.clientInfo as { name?: unknown } | undefined
      if (typeof info?.name === 'string') client = info.name
      return {
        protocolVersion:
          typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'troy', version: '1.0.0' }
      }
    }
    if (method === 'ping') return {}
    if (method === 'tools/list') return { tools: TOOLS }
    if (method === 'tools/call') {
      const args = (params.arguments ?? {}) as Record<string, unknown>
      // Tool failures go back to the agent as text it can act on, not as protocol errors.
      return callTool(params.name, args).catch((err) => text((err as Error).message, true))
    }
    throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 })
  }

  return async (msg) => {
    if (msg.id === undefined || msg.id === null || typeof msg.method !== 'string') return null
    try {
      return { jsonrpc: '2.0', id: msg.id, result: await result(msg.method, msg.params ?? {}) }
    } catch (err) {
      const code = (err as { code?: number }).code ?? -32603
      return { jsonrpc: '2.0', id: msg.id, error: { code, message: (err as Error).message } }
    }
  }
}
