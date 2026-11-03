import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const root = join(__dirname, '..')
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

// Two stand-in zips with known contents, so their checksums are known too.
function zips(): [string, string] {
  const dir = mkdtempSync(join(tmpdir(), 'troy-cask-'))
  const arm = join(dir, 'arm64.zip')
  const x64 = join(dir, 'x64.zip')
  writeFileSync(arm, 'arm64 build')
  writeFileSync(x64, 'x64 build')
  return [arm, x64]
}

const cask = (version: string, ...files: string[]): string =>
  execFileSync('sh', ['scripts/cask.sh', version, ...files], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe'
  })

describe('cask.sh', () => {
  it('fills the version and each zip’s checksum into the cask', () => {
    const out = cask('1.2.3', ...zips())
    expect(out).toContain('version "1.2.3"')
    expect(out).toContain(`arm:   "${sha256('arm64 build')}"`)
    expect(out).toContain(`intel: "${sha256('x64 build')}"`)
    expect(out).not.toMatch(/__[A-Z0-9_]+__/)
  })

  it('refuses a version that is not plain numbers', () => {
    expect(() => cask('1.0/../x', ...zips())).toThrow(/not a release version/)
  })

  it('fails when a zip is missing', () => {
    const [arm] = zips()
    expect(() => cask('1.2.3', arm, join(tmpdir(), 'no-such.zip'))).toThrow()
  })
})
