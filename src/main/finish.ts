import { git, run } from './worktrees'

const PUSH_TIMEOUT_MS = 60_000
// ponytail: untracked files past this are left out of the diff; paginate if people hit it.
const MAX_UNTRACKED_FILES = 200
const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/']

// Where the worktree left `base`, so later commits on the base don't count as its changes.
const forkPoint = (path: string, base: string): Promise<string> =>
  git(path, ['merge-base', 'HEAD', base]).catch(() => 'HEAD')

const untrackedFiles = async (path: string): Promise<string[]> =>
  (await git(path, ['ls-files', '--others', '--exclude-standard', '-z']))
    .split('\0')
    .filter(Boolean)
    .slice(0, MAX_UNTRACKED_FILES)

/** Everything this worktree changed since it left `base`: commits, edits and new files. */
export async function diffAgainst(path: string, base: string): Promise<string> {
  const mergeBase = await forkPoint(path, base)
  const tracked = await git(path, ['diff', ...DIFF_FLAGS, mergeBase])
  const untracked = await untrackedFiles(path)
  const added = await Promise.all(
    untracked.map((file) =>
      git(path, ['diff', '--no-index', ...DIFF_FLAGS, '--', '/dev/null', file], { okCodes: [1] })
    )
  )
  return [tracked, ...added].filter(Boolean).join('\n')
}

/** The paths `diffAgainst` covers, sorted. */
export async function changedFiles(path: string, base: string): Promise<string[]> {
  const tracked = (await git(path, ['diff', '--name-only', '-z', await forkPoint(path, base)]))
    .split('\0')
    .filter(Boolean)
  return [...new Set([...tracked, ...(await untrackedFiles(path))])].sort()
}

export async function commitAll(path: string, message: string): Promise<void> {
  if (!message.trim()) throw new Error('Write a commit message first.')
  await git(path, ['add', '-A'])
  await git(path, ['commit', '-m', message])
}

export async function push(path: string): Promise<void> {
  await git(path, ['push', '-u', 'origin', 'HEAD'], { timeout: PUSH_TIMEOUT_MS })
}

/** Pushes, then opens the branch's PR in the browser, starting a new one if none exists. */
export async function openPullRequest(path: string): Promise<void> {
  await push(path)
  const opened = await run('gh', ['pr', 'view', '--web'], path).then(
    () => true,
    () => false
  )
  if (!opened) await run('gh', ['pr', 'create', '--fill', '--web'], path)
}
