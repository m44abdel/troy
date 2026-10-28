import { ipcMain, shell } from 'electron'
import { readFile, realpath, stat } from 'fs/promises'
import { extname, isAbsolute, join, sep } from 'path'
import type { FileList, GrepHit, Preview } from '../shared/types'
import { attempt, locate } from './repos'
import { git } from './worktrees'

// Past this a preview would only stall the window; the editor button still opens it.
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024
const MAX_HITS = 500
const GREP_TIMEOUT_MS = 15_000

// Opening these runs them (or installs, or follows a link) instead of showing them.
const LAUNCHERS = new Set([
  '.app',
  '.command',
  '.tool',
  '.terminal',
  '.workflow',
  '.scpt',
  '.applescript',
  '.pkg',
  '.mpkg',
  '.dmg',
  '.jar',
  '.webloc',
  '.inetloc',
  '.fileloc'
])

/** Whether the OS would run `file` when asked to open it, from its name and permission bits. */
export const launches = (file: string, mode: number): boolean =>
  (mode & 0o111) !== 0 || LAUNCHERS.has(extname(file).toLowerCase())

const nulSplit = (out: string): string[] => out.split('\0').filter(Boolean)

/** The real path of `rel` in the worktree `root`. Refuses anything that resolves outside it. */
export async function insideWorktree(root: string, rel: unknown): Promise<string> {
  if (typeof rel !== 'string' || !rel) throw new Error('No file given.')
  const outside = new Error(`${rel} is outside the worktree.`)
  if (isAbsolute(rel)) throw outside
  const base = await realpath(root)
  const real = await realpath(join(base, rel))
  if (real !== base && !real.startsWith(base + sep)) throw outside
  return real
}

/** Tracked and new files, plus what .gitignore hides (folders end in "/"). */
export async function listFiles(root: string): Promise<FileList> {
  const [files, ignored] = await Promise.all([
    git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
    git(root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'])
  ])
  return { files: nulSplit(files), ignored: nulSplit(ignored) }
}

export async function readPreview(root: string, rel: unknown): Promise<Preview> {
  const file = await insideWorktree(root, rel)
  if (!(await stat(file)).isFile()) throw new Error(`${rel} is not a file.`)
  if ((await stat(file)).size > MAX_PREVIEW_BYTES) return { tooLarge: true }
  const bytes = await readFile(file)
  return bytes.includes(0) ? { binary: true } : { text: bytes.toString('utf8') }
}

/** Parses `git grep -n --null`: file, NUL, line number, NUL, the line. */
export const parseGrep = (out: string): GrepHit[] =>
  out
    .split('\n')
    .filter(Boolean)
    .map((row) => {
      const [file, line, ...text] = row.split('\0')
      return { file, line: Number(line), text: text.join('\0') }
    })

/** Lines holding `query`, any case, in tracked and new files; capped at MAX_HITS. */
export async function grep(root: string, query: string): Promise<GrepHit[]> {
  if (!query.trim()) return []
  const args = ['grep', '-n', '-I', '-i', '-F', '--untracked', '--no-color', '--null', '-e', query]
  const out = await git(root, args, { timeout: GREP_TIMEOUT_MS, okCodes: [1] })
  return parseGrep(out).slice(0, MAX_HITS)
}

export function registerFiles(): void {
  ipcMain.handle('files:list', (_e, path) =>
    attempt(async () => listFiles((await locate(path)).path))
  )
  ipcMain.handle('files:read', (_e, path, rel) =>
    attempt(async () => readPreview((await locate(path)).path, rel))
  )
  ipcMain.handle('files:grep', (_e, path, query) =>
    attempt(async () => ({ hits: await grep((await locate(path)).path, String(query ?? '')) }))
  )
  // A repo can hold scripts and apps; those are shown in Finder rather than run.
  ipcMain.handle('files:open', (_e, path, rel) =>
    attempt(async () => {
      const file = await insideWorktree((await locate(path)).path, rel)
      const info = await stat(file)
      if (!info.isFile() || launches(file, info.mode)) {
        shell.showItemInFolder(file)
        return {}
      }
      const failed = await shell.openPath(file)
      if (failed) throw new Error(failed)
      return {}
    })
  )
}
