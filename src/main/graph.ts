import { app } from 'electron'
import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { mkdir, readFile, realpath, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { McpLaunch } from './mcp-config'
import { run } from './worktrees'

// graphify (https://github.com/safishamsi/graphify) turns a repo into a code graph with
// tree-sitter, locally and with no LLM in --code-only mode. Troy builds one per repo and
// shares it: agents query it over MCP, and the overlap radar reads its dependencies.

const BUILD_TIMEOUT_MS = 5 * 60_000

const DEPENDENCY_RELATIONS = new Set([
  'imports',
  'imports_from',
  'calls',
  'indirect_call',
  'dynamic_import',
  'extends',
  'inherits',
  'references'
])

// Every package import points at the manifest, which would link every file to every other.
const MANIFEST = /(^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|Gemfile)$/

interface GraphJson {
  nodes: Array<{ id: string; source_file?: string }>
  links?: Array<{ source: string; target: string; relation: string }>
}

// Kept in Troy's own folder, so building never touches the repo.
const graphDir = (repo: string): string =>
  join(
    app.getPath('userData'),
    'graphs',
    createHash('sha1').update(repo).digest('hex').slice(0, 12)
  )
const graphJson = (repo: string): string => join(graphDir(repo), 'graphify-out', 'graph.json')
const mcpConfig = (repo: string): string => join(graphDir(repo), 'mcp.json')

/** For each file, the other files its code imports, calls or extends. */
export function fileDependencies(graph: GraphJson): Record<string, string[]> {
  const fileOf = new Map(graph.nodes.map((n) => [n.id, n.source_file]))
  const deps: Record<string, Set<string>> = {}
  for (const link of graph.links ?? []) {
    if (!DEPENDENCY_RELATIONS.has(link.relation)) continue
    const from = fileOf.get(link.source)
    const to = fileOf.get(link.target)
    if (!from || !to || from === to || MANIFEST.test(to)) continue
    ;(deps[from] ??= new Set()).add(to)
  }
  return Object.fromEntries(Object.entries(deps).map(([f, set]) => [f, [...set].sort()]))
}

/**
 * The Python that runs graphify: the one beside the real script (uv and pipx virtualenvs,
 * whose launcher is a relocatable /bin/sh trampoline), else one its shebang names.
 */
export async function graphifyPython(graphify: string): Promise<string | null> {
  const script = await realpath(graphify).catch(() => graphify)
  const sibling = join(dirname(script), 'python')
  if (existsSync(sibling)) return sibling
  const shebang = (await readFile(script, 'utf8').catch(() => '')).split('\n')[0]
  return /^#!(\S*\/python[\d.]*)\s*$/.exec(shebang)?.[1] ?? null
}

// graphify's server lives in its own virtualenv; reuse that Python if it has the MCP extra.
async function servePython(graphify: string): Promise<string | null> {
  const python = await graphifyPython(graphify)
  if (!python) return null
  return run(python, ['-c', 'import graphify.serve, mcp'], homedir()).then(
    () => python,
    () => {
      console.warn('graphify has no MCP extra; install graphifyy[mcp] to share the graph.')
      return null
    }
  )
}

async function build(repo: string): Promise<void> {
  const graphify = await run('which', ['graphify'], homedir()).catch(() => '')
  if (!graphify) return
  await mkdir(graphDir(repo), { recursive: true })
  await run(graphify, ['extract', repo, '--code-only', '--out', graphDir(repo)], repo, {
    timeout: BUILD_TIMEOUT_MS
  })
  const python = await servePython(graphify)
  if (!python) return
  const server: McpLaunch = {
    command: python,
    args: ['-m', 'graphify.serve', graphJson(repo)],
    env: {}
  }
  await writeFile(mcpConfig(repo), JSON.stringify({ mcpServers: { graph: server } }, null, 2))
}

const building = new Map<string, Promise<void>>()

/** Builds or refreshes the repo's graph when graphify is on PATH. Never throws. */
export function buildGraph(repo: string): Promise<void> {
  const pending = building.get(repo)
  if (pending) return pending
  const next = build(repo)
    .catch((err) => console.warn(`Could not build the code graph for ${repo}`, err))
    .finally(() => building.delete(repo))
  building.set(repo, next)
  return next
}

/** The graph's MCP server for agents, once a build has written it. */
export function graphServer(repo: string): { config: string; server: McpLaunch } | null {
  try {
    const parsed = JSON.parse(readFileSync(mcpConfig(repo), 'utf8'))
    return { config: mcpConfig(repo), server: parsed.mcpServers.graph }
  } catch {
    return null
  }
}

/** File dependencies from the repo's graph, after any build in progress; empty without one. */
export async function graphDependencies(repo: string): Promise<Record<string, string[]>> {
  await building.get(repo)
  try {
    return fileDependencies(JSON.parse(await readFile(graphJson(repo), 'utf8')))
  } catch {
    return {}
  }
}
