import { mkdtemp, rm, writeFile } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { basename, join } from 'path'
import type { PullRequest, ReviewComment, ReviewEvent, ReviewMeta } from '../shared/types'
import { git, listWorktrees, run } from './worktrees'

const FETCH_TIMEOUT_MS = 60_000
const SEARCH_FIELDS = 'number,title,url,repository,author,updatedAt'
const VIEW_FIELDS = 'title,body,url,author,baseRefName'

export const REVIEW_EVENTS: ReviewEvent[] = ['COMMENT', 'APPROVE', 'REQUEST_CHANGES']

/** "owner/name" from a GitHub remote URL, lowercased, or null for other hosts. */
export function githubSlug(remote: string): string | null {
  const match = remote.trim().match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/i)
  return match ? match[1].toLowerCase() : null
}

// The configured URL, not `remote get-url`, which rewrites it through any insteadOf.
export const repoSlug = async (repo: string): Promise<string | null> =>
  githubSlug(await git(repo, ['config', '--get', 'remote.origin.url']).catch(() => ''))

interface SearchHit {
  number: number
  title: string
  url: string
  updatedAt: string
  repository: { nameWithOwner: string }
  author: { login: string }
}

/** Open PRs waiting on your review, each paired with the local clone Troy knows, if any. */
export async function listRequested(repos: string[]): Promise<PullRequest[]> {
  const out = await run(
    'gh',
    ['search', 'prs', '--review-requested=@me', '--state=open', '--json', SEARCH_FIELDS],
    homedir()
  )
  const slugs = await Promise.all(repos.map(async (repo) => [await repoSlug(repo), repo]))
  const local = new Map(slugs.filter(([slug]) => slug) as [string, string][])
  return (JSON.parse(out || '[]') as SearchHit[]).map((hit) => ({
    number: hit.number,
    title: hit.title,
    url: hit.url,
    updatedAt: hit.updatedAt,
    slug: hit.repository.nameWithOwner,
    author: hit.author.login,
    repo: local.get(hit.repository.nameWithOwner.toLowerCase()) ?? null
  }))
}

/** Where a PR's throwaway checkout lives. */
export const reviewPath = (dir: string, repo: string, number: number): string =>
  join(dir, `${basename(repo)}-${number}`)

async function requireSlug(repo: string): Promise<string> {
  const slug = await repoSlug(repo)
  if (!slug) throw new Error(`${repo} has no GitHub origin remote.`)
  return slug
}

/** Checks the PR's head out into a detached worktree and fetches what the review needs. */
export async function openReview(
  dir: string,
  repo: string,
  number: number
): Promise<{ path: string; diff: string; meta: ReviewMeta }> {
  const slug = await requireSlug(repo)
  const path = reviewPath(dir, repo, number)
  if (!(await listWorktrees(repo)).some((wt) => wt.path === path)) {
    // pull/N/head exists on the base repo even when the PR comes from a fork.
    // ponytail: two PRs of one repo opened at the same instant could race on FETCH_HEAD.
    await git(repo, ['fetch', 'origin', `pull/${number}/head`], { timeout: FETCH_TIMEOUT_MS })
    await git(repo, ['worktree', 'add', '--detach', path, 'FETCH_HEAD'])
  }
  const pr = ['--repo', slug, String(number)]
  const [diff, view] = await Promise.all([
    run('gh', ['pr', 'diff', '--color', 'never', ...pr], path),
    run('gh', ['pr', 'view', '--json', VIEW_FIELDS, ...pr], path)
  ])
  const { title, body, url, author, baseRefName } = JSON.parse(view)
  return {
    path,
    diff,
    meta: { number, slug, title, body, url, author: author.login, base: baseRefName }
  }
}

/** The body of GitHub's "create a review" call. */
export const reviewPayload = (
  commitId: string,
  event: ReviewEvent,
  body: string,
  comments: ReviewComment[]
): Record<string, unknown> => ({
  commit_id: commitId,
  event,
  body,
  comments: comments.map((c) => ({
    path: c.file,
    line: c.line,
    side: c.removed ? 'LEFT' : 'RIGHT',
    body: c.text
  }))
})

/** Posts every comment as one review on the commit that was checked out, then cleans up. */
export async function submitReview(
  dir: string,
  repo: string,
  number: number,
  event: ReviewEvent,
  body: string,
  comments: ReviewComment[]
): Promise<void> {
  const slug = await requireSlug(repo)
  const path = reviewPath(dir, repo, number)
  const commitId = await git(path, ['rev-parse', 'HEAD'])
  const tmp = await mkdtemp(join(tmpdir(), 'troy-review-'))
  try {
    const input = join(tmp, 'review.json')
    await writeFile(input, JSON.stringify(reviewPayload(commitId, event, body, comments)))
    await run(
      'gh',
      ['api', '--method', 'POST', `repos/${slug}/pulls/${number}/reviews`, '--input', input],
      path
    )
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
  await closeReview(dir, repo, number)
}

/** Removes the PR's checkout. Safe to call when it is already gone. */
export async function closeReview(dir: string, repo: string, number: number): Promise<void> {
  const path = reviewPath(dir, repo, number)
  if ((await listWorktrees(repo)).some((wt) => wt.path === path))
    await git(repo, ['worktree', 'remove', '--force', path])
}
