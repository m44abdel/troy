import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import { DEFAULT_BINDINGS } from '../shared/keys'
import { installedAgents, loadBindings } from './settings'

describe('loadBindings', () => {
  it('creates an empty file, so later changes to the defaults still reach you', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'troy-keys-')), 'keybindings.json')
    expect(await loadBindings(path)).toEqual(DEFAULT_BINDINGS)
    expect(readFileSync(path, 'utf8')).toBe('{}\n')
  })

  it('lays the file over the defaults', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'troy-keys-')), 'keybindings.json')
    writeFileSync(path, JSON.stringify({ KeyK: 'newWorktree' }))
    const bindings = await loadBindings(path)
    expect(bindings.KeyK).toBe('newWorktree')
    expect(bindings.KeyW).toBe('closePane')
  })
})

describe('installedAgents', () => {
  const originalPath = process.env.PATH
  afterEach(() => {
    process.env.PATH = originalPath
  })

  it('executable agents on PATH', async () => {
    const [a, b] = [
      mkdtempSync(join(tmpdir(), 'troy-bin-')),
      mkdtempSync(join(tmpdir(), 'troy-bin-'))
    ]
    for (const [dir, name, mode] of [
      [b, 'codex', 0o755],
      [a, 'claude', 0o755],
      [a, 'aider', 0o644],
      [a, 'not-an-agent', 0o755]
    ] as const) {
      writeFileSync(join(dir, name), '#!/bin/sh\n')
      chmodSync(join(dir, name), mode)
    }
    process.env.PATH = [a, '', b].join(delimiter)

    expect(await installedAgents()).toEqual(['claude', 'codex'])
  })
})
