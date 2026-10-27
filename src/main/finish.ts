import type { Commit } from '../shared/types'
import { commandName } from '../shared/shell'
import { git, run } from './worktrees'

const PUSH_TIMEOUT_MS = 60_000
const MESSAGE_TIMEOUT_MS = 120_000
// Enough for the agent to see what changed; a huge diff would only slow it down.
const MAX_PROMPT_DIFF = 60_000
const MAX_COMMITS = 100
// Untracked files past this many drop out of the diff (no pagination yet).
const MAX_UNTRACKED_FILES = 200
const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/']

// Where the worktree left `base`. Commits the base got later aren't this worktree's changes.
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

/** The commits this worktree made since it left `base`, newest first. */
export async function branchCommits(path: string, base: string): Promise<Commit[]> {
  const range = `${await forkPoint(path, base)}..HEAD`
  const log = await git(path, [
    'log',
    '--no-color',
    `-n${MAX_COMMITS}`,
    '--format=%h%x00%s%x00%cr',
    range
  ])
  return log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, when] = line.split('\0')
      return { hash, subject, when }
    })
}

export function commitMessagePrompt(diff: string): string {
  const shown =
    diff.length > MAX_PROMPT_DIFF ? `${diff.slice(0, MAX_PROMPT_DIFF)}\n[diff cut short]` : diff
  return [
    "Write a git commit message for the changes below, following this repository's commit",
    'conventions if it has any. Reply with only the message: a subject line under 72',
    'characters, then optionally a blank line and a short body saying why.',
    '',
    shown
  ].join('\n')
}

/**
 * Asks Claude Code for a message for everything `commitAll` would commit. The run keeps no
 * session, so `--continue` still finds the worktree's real conversation, and gets no tools.
 */
export async function suggestCommitMessage(path: string, agent: string): Promise<string> {
  if (commandName(agent) !== 'claude')
    throw new Error('Only Claude Code can write commit messages so far.')
  const diff = await diffAgainst(path, 'HEAD')
  if (!diff) throw new Error('There is nothing to commit.')
  const args = ['--print', commitMessagePrompt(diff), '--no-session-persistence', '--tools', '']
  return run(agent.trim().split(/\s+/)[0], args, path, { timeout: MESSAGE_TIMEOUT_MS })
}
