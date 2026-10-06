// Troy's MCP server: lets any agent search approved knowledge and propose new facts.
// ponytail: hand-rolled JSON-RPC for the three methods it needs; the official SDK
// brings an HTTP stack (express, hono) Troy never uses.
import type { KnowledgeEntry } from '../shared/types'
import { formatEntry, propose, readKnowledge, SOURCE_HELP } from './knowledge'

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
export function createServer(cwd: string): (msg: Message) => Promise<object | null> {
  let client = 'unknown'

  async function callTool(name: unknown, args: Record<string, unknown>): Promise<object> {
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
