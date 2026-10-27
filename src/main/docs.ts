import { readFile } from 'fs/promises'
import { join } from 'path'
import { git } from './worktrees'

// No size cap. Add one if a repo ever keeps a giant markdown log.

/** Markdown files in the worktree, tracked or new, minus anything ignored. */
export async function listDocs(worktree: string): Promise<string[]> {
  const out = await git(worktree, [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
    '--',
    '*.md',
    '*.markdown'
  ])
  // A conflicted file is listed once per merge stage.
  return [...new Set(out.split('\0').filter(Boolean))].sort()
}

/** Reads one of listDocs' files; anything else (e.g. ../ paths) is refused. */
export async function readDoc(worktree: string, file: string): Promise<string> {
  if (!(await listDocs(worktree)).includes(file))
    throw new Error(`Not a markdown file here: ${file}`)
  return readFile(join(worktree, file), 'utf8')
}
