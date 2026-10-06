import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { changedFiles, commitAll, diffAgainst, push } from './finish'

function repoWithRemote(): { repo: string; remote: string; git: (...a: string[]) => string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'troy-finish-')))
  const remote = join(root, 'remote.git')
  const repo = join(root, 'app')
  execFileSync('git', ['init', '-q', '--bare', remote])
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args])
      .toString()
      .trim()
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git('add', '.')
  git('commit', '-qm', 'init')
  git('remote', 'add', 'origin', remote)
  git('config', 'user.name', 't')
  git('config', 'user.email', 't@t')
  return { repo, remote, git }
}

describe('diffAgainst', () => {
  it('covers commits since the base, uncommitted edits and untracked files', async () => {
    const { repo, git } = repoWithRemote()
    const base = git('rev-parse', 'HEAD')
    git('switch', '-qc', 'feat')
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n')
    git('commit', '-qam', 'two')
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\n')
    writeFileSync(join(repo, 'new.txt'), 'fresh\n')

    const diff = await diffAgainst(repo, base)

    expect(diff).toContain('diff --git a/a.txt b/a.txt')
    expect(diff).toContain('+two')
    expect(diff).toContain('+three')
    expect(diff).toContain('diff --git a/new.txt b/new.txt')
    expect(diff).toContain('+fresh')
  })

  it('is empty when nothing changed', async () => {
    const { repo, git } = repoWithRemote()
    expect(await diffAgainst(repo, git('rev-parse', 'HEAD'))).toBe('')
  })
})

describe('commitAll / push', () => {
  it('commits every change, including new files, and pushes the branch', async () => {
    const { repo, remote, git } = repoWithRemote()
    git('switch', '-qc', 'feat')
    writeFileSync(join(repo, 'new.txt'), 'fresh\n')

    await expect(commitAll(repo, '  ')).rejects.toThrow('commit message')
    await commitAll(repo, 'add new')
    await push(repo)

    expect(git('status', '--porcelain')).toBe('')
    expect(git('log', '-1', '--format=%s')).toBe('add new')
    expect(execFileSync('git', ['-C', remote, 'log', '-1', '--format=%s', 'feat']).toString()).toBe(
      'add new\n'
    )
  })
})

describe('changedFiles', () => {
  it('lists committed, edited and untracked files since the base, but not the base moving on', async () => {
    const { repo, git } = repoWithRemote()
    writeFileSync(join(repo, 'b.txt'), 'b\n')
    git('add', '.')
    git('commit', '-qm', 'b')
    git('switch', '-qc', 'feat')
    git('switch', '-q', 'main')
    writeFileSync(join(repo, 'main-only.txt'), 'later\n')
    git('add', '.')
    git('commit', '-qm', 'main moves on')
    git('switch', '-q', 'feat')
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n')
    git('commit', '-qam', 'two')
    writeFileSync(join(repo, 'b.txt'), 'edited\n')
    writeFileSync(join(repo, 'new.txt'), 'fresh\n')

    expect(await changedFiles(repo, 'main')).toEqual(['a.txt', 'b.txt', 'new.txt'])
  })
})
