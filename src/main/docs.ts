import { readFile } from 'fs/promises'
import { join } from 'path'
import { git } from './worktrees'

// ponytail: whole files, no size cap; add one if someone keeps a huge markdown log in the repo.

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
