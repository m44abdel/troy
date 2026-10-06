import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { listDocs, readDoc } from './docs'

describe('listDocs / readDoc', () => {
  it('lists tracked and new markdown, skips ignored files and refuses anything else', async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'troy-docs-')))
    execFileSync('git', ['init', '-q', '-b', 'main', repo])
    mkdirSync(join(repo, 'docs'))
    mkdirSync(join(repo, 'node_modules'))
    writeFileSync(join(repo, '.gitignore'), 'node_modules\n')
    writeFileSync(join(repo, 'README.md'), '# Hi\n')
    writeFileSync(join(repo, 'docs', 'guide.markdown'), 'guide\n')
    writeFileSync(join(repo, 'node_modules', 'dep.md'), 'ignored\n')
    writeFileSync(join(repo, 'notes.txt'), 'not markdown\n')
    execFileSync('git', ['-C', repo, 'add', 'README.md'])

    expect(await listDocs(repo)).toEqual(['README.md', 'docs/guide.markdown'])
    expect(await readDoc(repo, 'docs/guide.markdown')).toBe('guide\n')
    await expect(readDoc(repo, 'notes.txt')).rejects.toThrow('Not a markdown file')
    await expect(readDoc(repo, '../README.md')).rejects.toThrow('Not a markdown file')
  })
})
