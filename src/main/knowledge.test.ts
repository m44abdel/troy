import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  approve,
  checkSource,
  formatEntry,
  isStale,
  parseKnowledge,
  propose,
  readKnowledge,
  reject
} from './knowledge'
import { createWorktree } from './worktrees'

const entry = {
  fact: 'Retries stop after 3 tries.',
  source: 'src/api.ts:4',
  date: '2026-01-05',
  author: 'claude-code'
}

function tempRepo(): { repo: string; commit: (file: string, text: string, date: string) => void } {
  const repo = join(realpathSync(mkdtempSync(join(tmpdir(), 'troy-know-'))), 'app')
  mkdirSync(join(repo, 'src'), { recursive: true })
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  const commit = (file: string, text: string, date: string): void => {
    writeFileSync(join(repo, file), text)
    const env = {
      ...process.env,
      GIT_AUTHOR_DATE: `${date}T12:00:00`,
      GIT_COMMITTER_DATE: `${date}T12:00:00`
    }
    const git = (...args: string[]): void => {
      execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        env
      })
    }
    git('add', '.')
    git('commit', '-qm', `edit ${file}`)
  }
  commit('src/api.ts', 'a\nb\nc\nretries = 3\n', '2026-01-01')
  return { repo, commit }
}

describe('parseKnowledge / formatEntry', () => {
  it('round-trips entries and ignores everything else in the file', () => {
    const md = `# Project knowledge\n\nIntro text.\n\n${formatEntry(entry)}\n${formatEntry({ ...entry, fact: 'Second.' })}`
    expect(parseKnowledge(md)).toEqual([entry, { ...entry, fact: 'Second.' }])
    expect(parseKnowledge(md.replaceAll('\n', '\r\n'))).toHaveLength(2)
    expect(parseKnowledge('- a list item without a source line\n')).toEqual([])
  })
})

describe('checkSource', () => {
  it('accepts lines that exist, real commits and session ids', async () => {
    const { repo } = tempRepo()
    const head = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD']).toString().trim()
    await expect(checkSource(repo, 'src/api.ts:4')).resolves.toBeUndefined()
    await expect(checkSource(repo, 'src/api.ts:1-4')).resolves.toBeUndefined()
    await expect(checkSource(repo, head)).resolves.toBeUndefined()
    await expect(checkSource(repo, 'session:abc-123')).resolves.toBeUndefined()
  })

  it.each([
    ['a missing file', 'src/nope.ts:1', 'does not exist'],
    ['a line past the end', 'src/api.ts:5', 'out of range'],
    ['a reversed range', 'src/api.ts:3-2', 'out of range'],
    ['a path outside the repo', '../secret:1', 'relative to the repository'],
    ['an unknown commit', 'deadbeef', 'no commit'],
    ['free text', 'I read it somewhere', 'Source must be']
  ])('rejects %s', async (_name, source, message) => {
    const { repo } = tempRepo()
    await expect(checkSource(repo, source)).rejects.toThrow(message)
  })
})

describe('review queue', () => {
  it('queues a proposal from any worktree and approves it into the primary checkout', async () => {
    const { repo } = tempRepo()
    const { path: worktree } = await createWorktree(repo, 'feat-k', '')

    const proposal = await propose(worktree, {
      fact: '  Retries   stop\nafter 3 tries. ',
      source: 'src/api.ts:4',
      author: 'claude-code'
    })
    expect(proposal.fact).toBe('Retries stop after 3 tries.')
    expect((await readKnowledge(repo)).proposals).toEqual([proposal])
    // Nothing lands in either checkout until a person approves.
    expect(execFileSync('git', ['-C', worktree, 'status', '--porcelain']).toString()).toBe('')

    await approve(repo, proposal.id)

    const { entries, proposals } = await readKnowledge(worktree)
    expect(proposals).toEqual([])
    expect(entries).toEqual([{ ...entry, date: proposal.date, stale: false }])
    expect(readFileSync(join(repo, '.troy', 'knowledge.md'), 'utf8')).toMatch(
      /^# Project knowledge/
    )
    expect(existsSync(join(worktree, '.troy', 'knowledge.md'))).toBe(false)
  })

  it('rejects a proposal without touching knowledge.md and refuses unsafe ids', async () => {
    const { repo } = tempRepo()
    const proposal = await propose(repo, { fact: 'x', source: 'session:s1', author: '' })
    expect(proposal.author).toBe('unknown')

    await reject(repo, proposal.id)
    expect(await readKnowledge(repo)).toEqual({ entries: [], proposals: [] })
    await expect(approve(repo, '../../config')).rejects.toThrow('Invalid proposal id')
  })

  it('refuses a fact whose source does not check out', async () => {
    const { repo } = tempRepo()
    await expect(
      propose(repo, { fact: 'x', source: 'src/api.ts:99', author: 'a' })
    ).rejects.toThrow()
    expect((await readKnowledge(repo)).proposals).toEqual([])
  })
})

describe('staleness', () => {
  it('flags a fact once its cited file has a commit after the fact was recorded', async () => {
    const { repo, commit } = tempRepo()
    mkdirSync(join(repo, '.troy'))
    writeFileSync(
      join(repo, '.troy', 'knowledge.md'),
      formatEntry(entry) + formatEntry({ ...entry, source: 'session:s1' })
    )
    commit('src/other.ts', 'x\n', '2026-01-08')
    expect((await readKnowledge(repo)).entries.map((e) => e.stale)).toEqual([false, false])

    commit('src/api.ts', 'changed\n', '2026-01-10')
    expect((await readKnowledge(repo)).entries.map((e) => e.stale)).toEqual([true, false])
  })

  it('ignores changes on or before the entry date', () => {
    const changed = new Map([['src/api.ts', '2026-01-05']])
    expect(isStale(entry, changed)).toBe(false)
    expect(isStale(entry, new Map([['src/api.ts', '2026-01-06']]))).toBe(true)
  })
})
