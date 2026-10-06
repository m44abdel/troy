import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runCheck } from './check'

function repo(script?: string): { dir: string; runs: () => number } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'troy-check-')))
  const dir = join(root, 'app')
  const counter = join(root, 'runs')
  writeFileSync(counter, '')
  execFileSync('git', ['init', '-q', '-b', 'main', dir])
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  if (script) {
    mkdirSync(join(dir, '.troy'))
    // Counts runs outside the worktree, so counting doesn't change what is checked.
    writeFileSync(join(dir, '.troy', 'check'), `echo run >> ${counter}\n${script}`)
  }
  const git = (...args: string[]): void =>
    void execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args])
  git('add', '.')
  git('commit', '-qm', 'init')
  return { dir, runs: () => readFileSync(counter, 'utf8').split('\n').filter(Boolean).length }
}

describe('runCheck', () => {
  it('returns null when the repo has no check', async () => {
    expect(await runCheck(repo().dir)).toBeNull()
  })

  it('passes on exit 0 and fails with the output tail otherwise', async () => {
    const passing = await runCheck(repo('echo all good').dir)
    expect(passing).toMatchObject({ ok: true, output: 'all good' })

    const failing = await runCheck(repo('echo "2 tests failed" >&2; exit 1').dir)
    expect(failing).toMatchObject({ ok: false, output: '2 tests failed' })
  })

  it('reuses the result until the worktree changes', async () => {
    const { dir, runs } = repo('grep -q one a.txt')
    expect((await runCheck(dir))?.ok).toBe(true)
    expect((await runCheck(dir))?.ok).toBe(true)
    expect(runs()).toBe(1)

    writeFileSync(join(dir, 'a.txt'), 'two\n')
    expect((await runCheck(dir))?.ok).toBe(false)
    expect(runs()).toBe(2)
  })

  it('shares one run between concurrent callers', async () => {
    const { dir, runs } = repo('sleep 0.2')
    const [a, b] = await Promise.all([runCheck(dir), runCheck(dir)])
    expect(a).toBe(b)
    expect(runs()).toBe(1)
  })
})
