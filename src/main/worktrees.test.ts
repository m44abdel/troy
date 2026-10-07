import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createWorktree,
  findWorktree,
  listWorktrees,
  nextPortBase,
  parseWorktrees,
  removeWorktree,
  worktreePath
} from './worktrees'

describe('parseWorktrees', () => {
  it('reads branches, marks the first entry primary and skips bare/prunable ones', () => {
    const porcelain = [
      'worktree /r\nHEAD abc\nbranch refs/heads/main',
      'worktree /r.feat-x\nHEAD def\nbranch refs/heads/feat/x',
      'worktree /r.detached\nHEAD 123\ndetached',
      'worktree /gone\nHEAD 456\nbranch refs/heads/old\nprunable gitdir file points to non-existent location'
    ].join('\n\n')

    expect(parseWorktrees(porcelain)).toEqual([
      { path: '/r', branch: 'main', primary: true },
      { path: '/r.feat-x', branch: 'feat/x', primary: false },
      { path: '/r.detached', branch: null, primary: false }
    ])
  })
})

describe('worktree helpers', () => {
  it('places worktrees beside the repo with slashes flattened', () => {
    expect(worktreePath('/code/app', 'feat/login')).toBe('/code/app.feat-login')
  })

  it('hands out the first free port slot', () => {
    expect(nextPortBase([])).toBe(3100)
    expect(nextPortBase([3100, 3300])).toBe(3200)
  })
})

function tempRepo(): string {
  const repo = join(realpathSync(mkdtempSync(join(tmpdir(), 'troy-wt-'))), 'app')
  mkdirSync(repo)
  const git = (...args: string[]): void => {
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args])
  }
  git('init', '-q', '-b', 'main')
  writeFileSync(join(repo, '.gitignore'), '.env*\n')
  writeFileSync(join(repo, '.envrc.tracked'), 'tracked\n')
  git('add', '.')
  git('add', '-f', '.envrc.tracked')
  git('commit', '-qm', 'init')
  writeFileSync(join(repo, '.env'), 'SECRET=1\n')
  writeFileSync(join(repo, '.envrc.tracked'), 'local edit\n')
  return repo
}

describe('createWorktree / removeWorktree', () => {
  it('creates a sibling worktree, copies untracked .env files and archives it', async () => {
    const repo = tempRepo()

    const { path, base } = await createWorktree(repo, 'feat/x', '')

    expect(path).toBe(`${repo}.feat-x`)
    expect(base).toMatch(/^[0-9a-f]{40}$/)
    expect(readFileSync(join(path, '.env'), 'utf8')).toBe('SECRET=1\n')
    // Tracked files keep the committed version, not the primary's local edit.
    expect(readFileSync(join(path, '.envrc.tracked'), 'utf8')).toBe('tracked\n')
    expect((await listWorktrees(repo)).map((w) => w.branch)).toEqual(['main', 'feat/x'])

    await removeWorktree(repo, await findWorktree(repo, path), true)
    expect(existsSync(path)).toBe(false)
    expect(execFileSync('git', ['-C', repo, 'branch', '--list', 'feat/x']).toString()).toBe('')
  })

  it('honours .troy/copy patterns', async () => {
    const repo = tempRepo()
    mkdirSync(join(repo, '.troy'))
    writeFileSync(join(repo, '.troy', 'copy'), '# only this one\nconfig/local.json\n')
    mkdirSync(join(repo, 'config'))
    writeFileSync(join(repo, 'config', 'local.json'), '{}')

    const { path } = await createWorktree(repo, 'feat-y', '')

    expect(existsSync(join(path, 'config', 'local.json'))).toBe(true)
    expect(existsSync(join(path, '.env'))).toBe(false)
  })

  it('refuses the primary worktree, bad branch names and dirty worktrees', async () => {
    const repo = tempRepo()
    const [primary] = await listWorktrees(repo)
    await expect(removeWorktree(repo, primary, false)).rejects.toThrow('primary')
    await expect(createWorktree(repo, '--force', '')).rejects.toThrow('Invalid branch')
    await expect(createWorktree(repo, 'bad name', '')).rejects.toThrow()

    const { path } = await createWorktree(repo, 'dirty', '')
    writeFileSync(join(path, 'wip.txt'), 'unsaved')
    await expect(removeWorktree(repo, await findWorktree(repo, path), false)).rejects.toThrow()
    expect(existsSync(join(path, 'wip.txt'))).toBe(true)
  })
})

// A repo cloned from a bare remote where a teammate has since pushed to dev and feat/shared.
function cloneBehindRemote(): { repo: string; remote: string; sha: (ref: string) => string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'troy-pull-')))
  const remote = join(root, 'remote.git')
  const seed = join(root, 'seed')
  const repo = join(root, 'app')
  const run = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args])
      .toString()
      .trim()
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  execFileSync('git', ['clone', '-q', remote, seed])
  run(seed, 'commit', '-q', '--allow-empty', '-m', 'init')
  run(seed, 'push', '-q', 'origin', 'HEAD:main', 'HEAD:dev')
  execFileSync('git', ['clone', '-q', remote, repo])
  run(repo, 'branch', '-q', 'dev', 'origin/dev')
  run(seed, 'commit', '-q', '--allow-empty', '-m', 'teammate on dev')
  run(seed, 'push', '-q', 'origin', 'HEAD:dev', 'HEAD:feat/shared')
  return { repo, remote, sha: (ref) => run(repo, 'rev-parse', ref) }
}

describe('createWorktree from a remote', () => {
  it('starts from the latest remote base and fast-forwards the local base branch', async () => {
    const { repo, remote, sha } = cloneBehindRemote()
    const latest = execFileSync('git', ['-C', remote, 'rev-parse', 'dev']).toString().trim()

    const { path, base, warnings } = await createWorktree(repo, 'feat/new', 'dev')

    expect(base).toBe('origin/dev')
    expect(sha('dev')).toBe(latest)
    expect(execFileSync('git', ['-C', path, 'rev-parse', 'HEAD']).toString().trim()).toBe(latest)
    expect(warnings).toEqual([])
  })

  it('fast-forwards the base branch where it is checked out', async () => {
    const { repo, remote } = cloneBehindRemote()
    execFileSync('git', ['-C', repo, 'switch', '-q', 'dev'])
    const latest = execFileSync('git', ['-C', remote, 'rev-parse', 'dev']).toString().trim()

    await createWorktree(repo, 'feat/new', 'dev')

    expect(execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD']).toString().trim()).toBe(latest)
  })

  it('picks up a branch that already exists on the remote and tracks it', async () => {
    const { repo, sha } = cloneBehindRemote()

    const { path } = await createWorktree(repo, 'feat/shared', 'dev')

    expect(execFileSync('git', ['-C', path, 'rev-parse', 'HEAD']).toString().trim()).toBe(
      sha('origin/feat/shared')
    )
    expect(
      execFileSync('git', ['-C', path, 'rev-parse', '--abbrev-ref', '@{upstream}'])
        .toString()
        .trim()
    ).toBe('origin/feat/shared')
  })

  it('warns, and starts from what it has, when the remote cannot be reached', async () => {
    const { repo, sha } = cloneBehindRemote()
    execFileSync('git', ['-C', repo, 'remote', 'set-url', 'origin', join(repo, 'gone.git')])
    const stale = sha('origin/dev')

    const { path, warnings } = await createWorktree(repo, 'feat/offline', 'dev')

    expect(execFileSync('git', ['-C', path, 'rev-parse', 'HEAD']).toString().trim()).toBe(stale)
    expect(warnings).toEqual([expect.stringContaining('Could not fetch dev')])
  })
})
