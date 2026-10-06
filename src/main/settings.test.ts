import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import { installedAgents } from './settings'

describe('installedAgents', () => {
  const originalPath = process.env.PATH
  afterEach(() => {
    process.env.PATH = originalPath
  })

  it('lists known agents that are executable somewhere on PATH, in known order', async () => {
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
