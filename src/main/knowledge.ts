import { randomUUID } from 'crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises'
import { dirname, isAbsolute, join, normalize } from 'path'
import type { Knowledge, KnowledgeEntry, Proposal } from '../shared/types'
import { git, listWorktrees } from './worktrees'

// Approved facts live in the primary checkout, where the user commits them.
// Proposals wait in the git common dir: shared by every worktree, never committed.
export const KNOWLEDGE_FILE = join('.troy', 'knowledge.md')

const HEADER = `# Project knowledge

Facts about this repository that a person approved in Troy, each with the source it was checked against.
`

const ENTRY = /^- (.+)\n {2}Source: `([^`\n]+)` · (\d{4}-\d{2}-\d{2}) · (.+)$/gm
const FILE_SOURCE = /^(.+):(\d+)(?:-(\d+))?$/
const COMMIT_SOURCE = /^[0-9a-f]{7,40}$/
const SESSION_SOURCE = /^session:[\w.-]+$/
const PROPOSAL_ID = /^\d+-[0-9a-f]{8}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_FACT_LENGTH = 1000

export const SOURCE_HELP = 'path:line, path:start-end, a commit hash or session:<id>'

export function parseKnowledge(md: string): KnowledgeEntry[] {
  return [...md.replaceAll('\r\n', '\n').matchAll(ENTRY)].map(([, fact, source, date, author]) => ({
    fact,
    source,
    date,
    author
  }))
}

export const formatEntry = (e: KnowledgeEntry): string =>
  `- ${e.fact}\n  Source: \`${e.source}\` · ${e.date} · ${e.author}\n`

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

function today(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The file a source cites, or null for commits and sessions. */
function citedFile(source: string): string | null {
  if (SESSION_SOURCE.test(source)) return null
  return FILE_SOURCE.exec(source)?.[1] ?? null
}

/** Rejects sources that don't exist, so a fact can't cite a file or line the agent imagined. */
export async function checkSource(cwd: string, source: string): Promise<void> {
  if (/[`\r\n]/.test(source)) throw new Error(`Source must be ${SOURCE_HELP}.`)
  if (SESSION_SOURCE.test(source)) return
  if (COMMIT_SOURCE.test(source)) {
    const exists = await git(cwd, ['cat-file', '-e', `${source}^{commit}`]).then(
      () => true,
      () => false
    )
    if (!exists) throw new Error(`There is no commit ${source} in this repository.`)
    return
  }
  const match = FILE_SOURCE.exec(source)
  if (!match) throw new Error(`Source must be ${SOURCE_HELP}.`)
  const [, file, start, end = start] = match
  if (isAbsolute(file) || normalize(file).startsWith('..'))
    throw new Error('Source paths must be relative to the repository root.')
  const text = await readFile(join(cwd, file), 'utf8').catch(() => null)
  if (text === null) throw new Error(`${file} does not exist in this worktree.`)
  const lineCount = text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
  if (Number(start) < 1 || Number(end) < Number(start) || Number(end) > lineCount)
    throw new Error(`${file} has ${lineCount} lines; ${start}-${end} is out of range.`)
}

export async function repoPaths(cwd: string): Promise<{ primary: string; queue: string }> {
  const common = await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const primary = (await listWorktrees(cwd)).find((w) => w.primary)?.path ?? cwd
  return { primary, queue: join(common, 'troy', 'proposals') }
}

// Queue files sit outside the worktree and anything can write them, so check every field.
function parseProposal(raw: unknown): Proposal | null {
  const p = raw as Record<string, unknown>
  const fields = ['id', 'fact', 'source', 'date', 'author'] as const
  if (!fields.every((f) => typeof p?.[f] === 'string')) return null
  const [id, fact, source, date, author] = fields.map((f) => oneLine(p[f] as string))
  const proposal = { id, fact, source, date, author }
  const isValid =
    PROPOSAL_ID.test(proposal.id) &&
    DATE.test(proposal.date) &&
    proposal.fact !== '' &&
    !/[`]/.test(proposal.source)
  return isValid ? proposal : null
}

async function readProposals(queue: string): Promise<Proposal[]> {
  const names = (await readdir(queue).catch(() => [] as string[]))
    .filter((n) => n.endsWith('.json'))
    .sort()
  const proposals = await Promise.all(
    names.map(async (name) => {
      try {
        return parseProposal(JSON.parse(await readFile(join(queue, name), 'utf8')))
      } catch (err) {
        console.warn(`Skipping unreadable proposal ${name}`, err)
        return null
      }
    })
  )
  return proposals.filter((p): p is Proposal => p !== null)
}

export async function propose(
  cwd: string,
  input: { fact: string; source: string; author: string }
): Promise<Proposal> {
  const fact = oneLine(input.fact)
  if (!fact) throw new Error('The fact is empty.')
  if (fact.length > MAX_FACT_LENGTH)
    throw new Error(`Keep a fact under ${MAX_FACT_LENGTH} characters.`)
  const source = input.source.trim()
  await checkSource(cwd, source)

  const { queue } = await repoPaths(cwd)
  const proposal: Proposal = {
    id: `${Date.now()}-${randomUUID().slice(0, 8)}`,
    fact,
    source,
    date: today(),
    author: oneLine(input.author) || 'unknown'
  }
  await mkdir(queue, { recursive: true })
  await writeFile(join(queue, `${proposal.id}.json`), JSON.stringify(proposal))
  return proposal
}

async function readKnowledgeFile(primary: string): Promise<string | null> {
  try {
    return await readFile(join(primary, KNOWLEDGE_FILE), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

function proposalFile(queue: string, id: string): string {
  if (!PROPOSAL_ID.test(id)) throw new Error(`Invalid proposal id: ${id}`)
  return join(queue, `${id}.json`)
}

export async function approve(cwd: string, id: string): Promise<void> {
  const { primary, queue } = await repoPaths(cwd)
  const file = proposalFile(queue, id)
  const proposal = parseProposal(JSON.parse(await readFile(file, 'utf8')))
  if (!proposal) throw new Error('That proposal is malformed.')

  const path = join(primary, KNOWLEDGE_FILE)
  const existing = (await readKnowledgeFile(primary)) ?? HEADER
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${existing.trimEnd()}\n\n${formatEntry(proposal)}`)
  await rm(file)
}

export async function reject(cwd: string, id: string): Promise<void> {
  const { queue } = await repoPaths(cwd)
  await rm(proposalFile(queue, id), { force: true })
}

/** Latest commit date per file, over commits since `since` (YYYY-MM-DD). */
export async function lastChanged(repo: string, since: string): Promise<Map<string, string>> {
  const log = await git(repo, ['log', `--since=${since}`, '--format=%x00%cs', '--name-only'])
  const latest = new Map<string, string>()
  for (const commit of log.split('\0').filter(Boolean)) {
    const [date, ...files] = commit.split('\n').filter(Boolean)
    for (const file of files) if ((latest.get(file) ?? '') < date) latest.set(file, date)
  }
  return latest
}

// ponytail: day granularity, so a change later on the entry's own day isn't flagged;
// store a timestamp in the entry if that matters.
export function isStale(entry: KnowledgeEntry, changed: Map<string, string>): boolean {
  const file = citedFile(entry.source)
  const date = file ? changed.get(normalize(file)) : undefined
  return date !== undefined && date > entry.date
}

export async function readKnowledge(cwd: string): Promise<Knowledge> {
  const { primary, queue } = await repoPaths(cwd)
  const entries = parseKnowledge((await readKnowledgeFile(primary)) ?? '')
  const oldest = entries.map((e) => e.date).sort()[0]
  const changed = oldest ? await lastChanged(primary, oldest) : new Map<string, string>()
  return {
    entries: entries.map((e) => ({ ...e, stale: isStale(e, changed) })),
    proposals: await readProposals(queue)
  }
}
