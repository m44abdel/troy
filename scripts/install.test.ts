import { beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'fs'
import { arch, tmpdir } from 'os'
import { join, resolve } from 'path'

const ROOT = resolve(__dirname, '..')
const ARCH = arch() === 'arm64' ? 'arm64' : 'x64'

let sandbox: string
let env: NodeJS.ProcessEnv

/** A fake release zip laid out like GitHub's download URLs. */
function publish(version: string): void {
  const app = join(sandbox, 'build', version, 'Troy.app', 'Contents')
  mkdirSync(app, { recursive: true })
  writeFileSync(
    join(app, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`
  )
  const dir = join(sandbox, 'releases', 'download', `v${version}`)
  mkdirSync(dir, { recursive: true })
  execFileSync('ditto', [
    '-c',
    '-k',
    '--keepParent',
    join(sandbox, 'build', version, 'Troy.app'),
    join(dir, `Troy-${version}-mac-${ARCH}.zip`)
  ])
}

function sh(script: string, args: string[] = [], extra: NodeJS.ProcessEnv = {}): string {
  const result = spawnSync('sh', [join(ROOT, script), ...args], {
    env: { ...env, ...extra },
    encoding: 'utf8'
  })
  if (result.status !== 0) throw new Error(`${script} failed: ${result.stderr}${result.stdout}`)
  return result.stdout
}

const appDir = (): string => join(sandbox, 'Applications')
const installedApp = (): string => join(appDir(), 'Troy.app')
const manifest = (): string => join(sandbox, 'state', 'troy', 'install-manifest')
const installedVersion = (): string =>
  readFileSync(join(installedApp(), 'Contents', 'Info.plist'), 'utf8').match(
    /<string>(.+)<\/string>/
  )![1]

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'troy-install-'))
  mkdirSync(appDir())
  env = {
    ...process.env,
    TROY_RELEASES_URL: `file://${join(sandbox, 'releases')}`,
    TROY_APP_DIR: appDir(),
    XDG_STATE_HOME: join(sandbox, 'state')
  }
  publish('1.0.0')
  publish('1.1.0')
})

describe('install.sh', () => {
  it('--dry-run prints the steps and changes nothing', () => {
    const out = sh('install.sh', ['--dry-run'], { TROY_VERSION: '1.0.0' })
    expect(out).toContain('would run: curl')
    expect(out).toContain('would run: xattr -cr')
    expect(existsSync(installedApp())).toBe(false)
    expect(existsSync(manifest())).toBe(false)
  })

  it('installs, records the app in the manifest and does nothing on a re-run', () => {
    sh('install.sh', [], { TROY_VERSION: '1.0.0' })
    expect(installedVersion()).toBe('1.0.0')
    expect(readFileSync(manifest(), 'utf8')).toBe(`${installedApp()}\n`)

    const before = statSync(installedApp()).mtimeMs
    expect(sh('install.sh', [], { TROY_VERSION: '1.0.0' })).toContain('already installed')
    expect(statSync(installedApp()).mtimeMs).toBe(before)
  })

  it('replaces an older version', () => {
    sh('install.sh', [], { TROY_VERSION: '1.0.0' })
    expect(sh('install.sh', [], { TROY_VERSION: '1.1.0' })).toContain('replacing 1.0.0')
    expect(installedVersion()).toBe('1.1.0')
  })

  it('refuses a version string that could escape the download URL', () => {
    expect(() => sh('install.sh', [], { TROY_VERSION: '1.0.0/../../x' })).toThrow(
      'could not work out the latest version'
    )
  })
})

describe('uninstall.sh', () => {
  it('removes exactly what the manifest lists, and is a no-op afterwards', () => {
    sh('install.sh', [], { TROY_VERSION: '1.0.0' })

    expect(sh('uninstall.sh', ['--dry-run'])).toContain(`would run: rm -rf ${installedApp()}`)
    expect(existsSync(installedApp())).toBe(true)

    sh('uninstall.sh')
    expect(existsSync(installedApp())).toBe(false)
    expect(existsSync(manifest())).toBe(false)
    expect(sh('uninstall.sh')).toContain('Nothing to uninstall')
  })

  it('never deletes manifest entries that are not a Troy.app bundle', () => {
    const victim = join(sandbox, 'precious')
    mkdirSync(victim)
    mkdirSync(join(sandbox, 'state', 'troy'), { recursive: true })
    writeFileSync(manifest(), `${victim}\n`)

    expect(sh('uninstall.sh')).toContain(`Skipping unexpected manifest entry: ${victim}`)
    expect(existsSync(victim)).toBe(true)
  })
})
