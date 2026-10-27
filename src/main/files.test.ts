import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { grep, insideWorktree, listFiles, parseGrep, readPreview } from './files'

function repo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'troy-files-')))
  execFileSync('git', ['init', '-q', '-b', 'main', root])
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'app.ts'), 'const Port = 3100\nexport {}\n')
  writeFileSync(join(root, '.gitignore'), 'out/\n*.log\n')
  mkdirSync(join(root, 'out'))
  writeFileSync(join(root, 'out', 'bundle.js'), 'x')
  writeFileSync(join(root, 'debug.log'), 'x')
  return root
}

describe('insideWorktree', () => {
  it('resolves a file in the worktree', async () => {
    const root = repo()
    expect(await insideWorktree(root, 'src/app.ts')).toBe(join(root, 'src', 'app.ts'))
  })

  it('refuses paths that climb out of the worktree', async () => {
    const root = repo()
    writeFileSync(join(root, '..', 'secret.txt'), 'x')
    await expect(insideWorktree(root, '../secret.txt')).rejects.toThrow(/outside the worktree/)
    await expect(insideWorktree(root, '/etc/hosts')).rejects.toThrow(/outside the worktree/)
  })

  it('refuses a symlink that points outside', async () => {
    const root = repo()
    symlinkSync('/etc/hosts', join(root, 'hosts'))
    await expect(insideWorktree(root, 'hosts')).rejects.toThrow(/outside the worktree/)
  })
})

describe('readPreview', () => {
  it('returns the text of a file', async () => {
    const root = repo()
    expect(await readPreview(root, 'src/app.ts')).toEqual({
      text: 'const Port = 3100\nexport {}\n'
    })
  })

  it('says a file is binary instead of returning its bytes', async () => {
    const root = repo()
    writeFileSync(join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x01]))
    expect(await readPreview(root, 'logo.png')).toEqual({ binary: true })
  })
})

describe('listFiles', () => {
  it('lists tracked and new files, and ignored ones apart', async () => {
    const root = repo()
    expect(await listFiles(root)).toEqual({
      files: ['.gitignore', 'src/app.ts'],
      ignored: ['debug.log', 'out/']
    })
  })
})

describe('grep', () => {
  it('finds a word in any case, with file and line', async () => {
    const root = repo()
    expect(await grep(root, 'PORT =')).toEqual([
      { file: 'src/app.ts', line: 1, text: 'const Port = 3100' }
    ])
  })

  it('finds nothing without failing', async () => {
    expect(await grep(repo(), 'no-such-thing')).toEqual([])
  })

  it('keeps NUL-free text whole even when it holds colons', () => {
    expect(parseGrep('a.ts\u00002\u0000x: y\n')).toEqual([{ file: 'a.ts', line: 2, text: 'x: y' }])
  })
})
