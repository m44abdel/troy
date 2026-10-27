import { ipcMain } from 'electron'
import type {
  BranchPr,
  CheckState,
  Issue,
  MergeMethod,
  MergeOptions,
  OpenPr,
  PrCheck,
  PrComment,
  PrStatus
} from '../shared/types'
import { attempt, knownRepo, locate, prNumber } from './repos'
import { run } from './worktrees'

const GH_TIMEOUT_MS = 30_000
const MERGE_TIMEOUT_MS = 120_000
const PR_FIELDS = 'number,title,state,url,updatedAt,isDraft,mergeable,statusCheckRollup,comments'
const MERGE_FIELDS =
  'squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed,viewerDefaultMergeMethod'
const NO_PR = /no pull requests? found/i
const LIST_LIMIT = '100'
const TASK_LIMIT = '50'

const METHODS: Record<MergeMethod, string> = {
  squash: 'squashMergeAllowed',
  merge: 'mergeCommitAllowed',
  rebase: 'rebaseMergeAllowed'
}

type Json = Record<string, unknown>
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const optional = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

function checkState(c: Json): CheckState {
  if (c.__typename === 'StatusContext') {
    if (c.state === 'SUCCESS') return 'pass'
    return c.state === 'PENDING' || c.state === 'EXPECTED' ? 'pending' : 'fail'
  }
  if (c.status !== 'COMPLETED') return 'pending'
  if (c.conclusion === 'SUCCESS') return 'pass'
  return c.conclusion === 'SKIPPED' || c.conclusion === 'NEUTRAL' ? 'skipped' : 'fail'
}

/** GitHub's status rollup holds Actions runs (CheckRun) and other CI's statuses (StatusContext). */
export function parseChecks(rollup: unknown): PrCheck[] {
  if (!Array.isArray(rollup)) return []
  return rollup.map((c: Json) => ({
    name: str(c.name) || str(c.context),
    state: checkState(c),
    url: optional(c.detailsUrl) ?? optional(c.targetUrl)
  }))
}

const parseComments = (comments: unknown): PrComment[] =>
  Array.isArray(comments)
    ? comments.map((c: Json) => ({
        author: str((c.author as Json | undefined)?.login),
        body: str(c.body),
        createdAt: str(c.createdAt)
      }))
    : []

export function parsePr(json: unknown): PrStatus {
  const pr = (json ?? {}) as Json
  if (typeof pr.number !== 'number') throw new Error('gh returned something that is not a PR.')
  return {
    number: pr.number,
    title: str(pr.title),
    state: prState(pr.state),
    url: str(pr.url),
    updatedAt: str(pr.updatedAt),
    isDraft: pr.isDraft === true,
    mergeable: str(pr.mergeable),
    checks: parseChecks(pr.statusCheckRollup),
    comments: parseComments(pr.comments)
  }
}

export function parseMergeOptions(json: unknown): MergeOptions {
  const repo = (json ?? {}) as Json
  const permitted = (Object.keys(METHODS) as MergeMethod[]).filter((m) => repo[METHODS[m]] === true)
  const allowed = permitted.length ? permitted : (Object.keys(METHODS) as MergeMethod[])
  const wanted = str(repo.viewerDefaultMergeMethod).toLowerCase() as MergeMethod
  return { allowed, preferred: allowed.includes(wanted) ? wanted : allowed[0] }
}

const prState = (v: unknown): PrStatus['state'] => (v === 'MERGED' || v === 'CLOSED' ? v : 'OPEN')

/** Each branch's open PR, or else its newest one. `gh pr list` lists newest first. */
export function latestPrByBranch(list: unknown): Record<string, BranchPr> {
  const byBranch: Record<string, BranchPr> = {}
  for (const pr of Array.isArray(list) ? (list as Json[]) : []) {
    const branch = str(pr.headRefName)
    if (typeof pr.number !== 'number' || !branch) continue
    const seen = byBranch[branch]
    if (!seen || (seen.state !== 'OPEN' && pr.state === 'OPEN'))
      byBranch[branch] = { number: pr.number, state: prState(pr.state) }
  }
  return byBranch
}

export const parseIssues = (list: unknown): Issue[] =>
  (Array.isArray(list) ? (list as Json[]) : []).map((i) => ({
    number: Number(i.number),
    title: str(i.title),
    url: str(i.url),
    updatedAt: str(i.updatedAt),
    labels: Array.isArray(i.labels) ? i.labels.map((l: Json) => str(l.name)) : [],
    body: str(i.body)
  }))

const parseOpenPrs = (list: unknown): OpenPr[] =>
  (Array.isArray(list) ? (list as Json[]) : []).map((p) => ({
    number: Number(p.number),
    title: str(p.title),
    url: str(p.url),
    updatedAt: str(p.updatedAt),
    author: str((p.author as Json | undefined)?.login),
    isDraft: p.isDraft === true
  }))

const gh = async (args: string[], cwd: string): Promise<unknown> =>
  JSON.parse(await run('gh', args, cwd, { timeout: GH_TIMEOUT_MS }))

/** The PR of the branch checked out in `path`, or null when it has none. */
async function prStatus(path: string): Promise<PrStatus | null> {
  try {
    const out = await run('gh', ['pr', 'view', '--json', PR_FIELDS], path, {
      timeout: GH_TIMEOUT_MS
    })
    return parsePr(JSON.parse(out))
  } catch (err) {
    if (NO_PR.test((err as Error).message)) return null
    throw err
  }
}

async function mergeOptions(path: string): Promise<MergeOptions> {
  const out = await run('gh', ['repo', 'view', '--json', MERGE_FIELDS], path, {
    timeout: GH_TIMEOUT_MS
  })
  return parseMergeOptions(JSON.parse(out))
}

const mergeMethod = (m: unknown): MergeMethod => {
  if (typeof m === 'string' && m in METHODS) return m as MergeMethod
  throw new Error(`Not a merge method: ${m}`)
}

export function registerGithub(): void {
  ipcMain.handle('pr:byBranch', (_e, repo) =>
    attempt(async () => {
      const args = ['pr', 'list', '--state', 'all', '--json', 'number,state,headRefName']
      return {
        prs: latestPrByBranch(await gh([...args, '--limit', LIST_LIMIT], await knownRepo(repo)))
      }
    })
  )
  ipcMain.handle('tasks:list', (_e, repo) =>
    attempt(async () => {
      const cwd = await knownRepo(repo)
      const [issues, prs] = await Promise.all([
        gh(
          [
            'issue',
            'list',
            '--json',
            'number,title,url,updatedAt,labels,body',
            '--limit',
            TASK_LIMIT
          ],
          cwd
        ),
        gh(
          [
            'pr',
            'list',
            '--json',
            'number,title,url,updatedAt,author,isDraft',
            '--limit',
            TASK_LIMIT
          ],
          cwd
        )
      ])
      return { issues: parseIssues(issues), prs: parseOpenPrs(prs) }
    })
  )
  ipcMain.handle('pr:get', (_e, path) =>
    attempt(async () => {
      const wt = await locate(path)
      const pr = await prStatus(wt.path)
      return { pr, merge: pr?.state === 'OPEN' ? await mergeOptions(wt.path) : undefined }
    })
  )
  // Leaves the branch in place: the worktree still has it checked out.
  ipcMain.handle('pr:merge', (_e, path, n, method) =>
    attempt(async () => {
      const wt = await locate(path)
      const args = ['pr', 'merge', String(prNumber(n)), `--${mergeMethod(method)}`]
      await run('gh', args, wt.path, { timeout: MERGE_TIMEOUT_MS })
      return {}
    })
  )
  ipcMain.handle('pr:comment', (_e, path, n, body) =>
    attempt(async () => {
      const text = typeof body === 'string' ? body.trim() : ''
      if (!text) throw new Error('Write a comment first.')
      const wt = await locate(path)
      await run('gh', ['pr', 'comment', String(prNumber(n)), '--body', text], wt.path, {
        timeout: GH_TIMEOUT_MS
      })
      return {}
    })
  )
}
