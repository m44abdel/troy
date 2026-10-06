import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { access, cp, glob, readFile } from 'fs/promises'
import { isAbsolute, join, relative } from 'path'
import { promisify } from 'util'
import type { Worktree } from '../shared/types'

const exec = promisify(execFile)

const FETCH_TIMEOUT_MS = 30_000
const DEFAULT_COPY = ['.env*']
export const PORT_START = 3000
export const PORT_STEP = 100

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

interface RunOptions {
  timeout?: number
  /** Exit codes that still mean success, e.g. 1 for `git diff --no-index`. */
  okCodes?: number[]
}

export async function run(
  file: string,
  args: string[],
  cwd: string,
  { timeout = 0, okCodes = [] }: RunOptions = {}
): Promise<string> {
  try {
    const { stdout } = await exec(file, args, {
      cwd,
      timeout,
      maxBuffer: MAX_OUTPUT_BYTES,
      // Fail instead of hanging on a credential prompt nobody can see.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    return stdout.trim()
  } catch (err) {
    const { code, stdout, stderr } = err as { code?: unknown; stdout?: string; stderr?: string }
    if (typeof code === 'number' && okCodes.includes(code)) return (stdout ?? '').trim()
    if (code === 'ENOENT')
      throw new Error(
        existsSync(cwd) ? `${file} is not installed or not on PATH.` : `${cwd} does not exist.`
      )
    throw new Error(stderr?.trim() || (err as Error).message)
  }
}

export const git = (cwd: string, args: string[], options?: RunOptions): Promise<string> =>
  run('git', args, cwd, options)

export function parseWorktrees(porcelain: string): Worktree[] {
  return porcelain
    .split(/\n\n+/)
    .filter((block) => block.trim())
    .flatMap((block, i) => {
      const lines = block.split('\n')
      if (lines.some((l) => l === 'bare' || l.startsWith('prunable'))) return []
      const ref = lines.find((l) => l.startsWith('branch '))?.slice('branch '.length)
      return [
        {
          path: lines[0].replace(/^worktree /, ''),
          branch: ref ? ref.replace(/^refs\/heads\//, '') : null,
          primary: i === 0
        }
      ]
    })
}

export async function listWorktrees(repo: string): Promise<Worktree[]> {
  return parseWorktrees(await git(repo, ['worktree', 'list', '--porcelain']))
}

// Same layout as worktrunk: a sibling directory named <repo>.<branch>.
export function worktreePath(repo: string, branch: string): string {
  return `${repo}.${branch.replaceAll('/', '-')}`
}

export function nextPortBase(used: number[]): number {
  let port = PORT_START + PORT_STEP
  while (used.includes(port)) port += PORT_STEP
  return port
}

async function startPoint(repo: string, base: string): Promise<string> {
  const remotes = (await git(repo, ['remote'])).split('\n')
  if (!remotes.includes('origin')) return base || 'HEAD'

  const branch =
    base ||
    (await git(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).then(
      (ref) => ref.replace(/^origin\//, ''),
      () => ''
    ))
  if (!branch) return 'HEAD'

  // Offline or a local-only base: fall back to whatever we already have.
  await git(repo, ['fetch', 'origin', branch], { timeout: FETCH_TIMEOUT_MS }).catch((err) =>
    console.warn(`git fetch origin ${branch} failed:`, err.message)
  )
  const remoteRef = `origin/${branch}`
  const hasRemoteRef = await git(repo, ['rev-parse', '--verify', '--quiet', remoteRef]).then(
    () => true,
    () => false
  )
  return hasRemoteRef ? remoteRef : branch
}

async function copyPatterns(repo: string): Promise<string[]> {
  try {
    return (await readFile(join(repo, '.troy', 'copy'), 'utf8'))
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_COPY
    throw err
  }
}

// Copies untracked files like .env into a new worktree. Files the worktree
// already has (tracked ones) are left alone.
export async function copyUntracked(from: string, to: string): Promise<string[]> {
  const copied: string[] = []
  for await (const match of glob(await copyPatterns(from), { cwd: from })) {
    const rel = relative(from, join(from, match))
    if (rel.startsWith('..') || isAbsolute(rel)) continue
    await cp(join(from, rel), join(to, rel), { recursive: true, force: false })
    copied.push(rel)
  }
  return copied
}

/** Creates the worktree and returns its path plus the ref its diff is measured against. */
export async function createWorktree(
  repo: string,
  branch: string,
  base: string
): Promise<{ path: string; base: string }> {
  if (!branch || branch.startsWith('-')) throw new Error(`Invalid branch name: "${branch}"`)
  await git(repo, ['check-ref-format', '--branch', branch])

  const path = worktreePath(repo, branch)
  const start = await startPoint(repo, base)
  // --no-track so a plain `git push` never targets the base branch.
  await git(repo, ['worktree', 'add', '--no-track', '-b', branch, path, start])
  await copyUntracked(repo, path)
  // A bare HEAD would move with the new branch, so pin it to the commit we started from.
  return { path, base: start === 'HEAD' ? await git(repo, ['rev-parse', 'HEAD']) : start }
}

export async function hasSetupScript(path: string): Promise<boolean> {
  return access(join(path, '.troy', 'setup.sh')).then(
    () => true,
    () => false
  )
}

export async function findWorktree(repo: string, path: string): Promise<Worktree> {
  const wt = (await listWorktrees(repo)).find((w) => w.path === path)
  if (!wt) throw new Error(`${path} is not a worktree of ${repo}.`)
  return wt
}

// No --force: git refuses when there are uncommitted changes, and we let it.
export async function removeWorktree(
  repo: string,
  wt: Worktree,
  deleteBranch: boolean
): Promise<void> {
  if (wt.primary) throw new Error('The primary worktree cannot be archived.')
  await git(repo, ['worktree', 'remove', wt.path])
  if (deleteBranch && wt.branch) await git(repo, ['branch', '-D', wt.branch])
}
