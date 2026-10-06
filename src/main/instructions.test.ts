import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { stripInstructions, upsertBlock, writeInstructions } from './instructions'

function tempRepo(files: Record<string, string> = {}): {
  repo: string
  git: (...a: string[]) => string
} {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'troy-instr-')))
  const git = (...args: string[]): string =>
    execFileSync('git', [
      '-C',
      repo,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      ...args
    ]).toString()
  git('init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'README.md'), 'hi\n')
  for (const [name, text] of Object.entries(files)) writeFileSync(join(repo, name), text)
  git('add', '.')
  git('commit', '-qm', 'init')
  return { repo, git }
}

describe('upsertBlock', () => {
  it('appends once and refreshes in place', () => {
    const once = upsertBlock('# Rules\n\nBe nice.\n')
    expect(once).toMatch(/^# Rules\n\nBe nice.\n\n<!-- troy:knowledge -->/)
    expect(upsertBlock(once)).toBe(once)

    const outdated = once.replace('Read it before exploring.', 'old text') + '\nAfter.\n'
    expect(upsertBlock(outdated)).toBe(once + '\nAfter.\n')
  })
})

describe('writeInstructions / stripInstructions', () => {
  it("creates the agent's own file and updates whichever files already exist", async () => {
    const { repo } = tempRepo({ 'AGENTS.md': '# Agents\n' })
    await writeInstructions(repo, '/usr/local/bin/claude --resume')
    expect(readFileSync(join(repo, 'CLAUDE.md'), 'utf8')).toContain('.troy/knowledge.md')
    expect(readFileSync(join(repo, 'AGENTS.md'), 'utf8')).toMatch(/^# Agents\n\n<!-- troy/)
  })

  it('undoes only its own uncommitted edits, leaving the worktree clean', async () => {
    const { repo, git } = tempRepo({ 'AGENTS.md': '# Agents\n' })
    await writeInstructions(repo, 'claude')
    expect(git('status', '--porcelain')).not.toBe('')

    await stripInstructions(repo)
    expect(git('status', '--porcelain')).toBe('')
    expect(existsSync(join(repo, 'CLAUDE.md'))).toBe(false)
  })

  it('keeps a committed block and any edits of the agent or user', async () => {
    const { repo, git } = tempRepo({ 'AGENTS.md': upsertBlock('# Agents\n') })
    await writeInstructions(repo, 'codex')
    expect(git('status', '--porcelain')).toBe('')

    writeFileSync(join(repo, 'AGENTS.md'), upsertBlock('# Agents\n') + 'Agent notes.\n')
    await stripInstructions(repo)
    expect(readFileSync(join(repo, 'AGENTS.md'), 'utf8')).toContain('Agent notes.')
    expect(readFileSync(join(repo, 'AGENTS.md'), 'utf8')).toContain('<!-- troy:knowledge -->')
  })
})
