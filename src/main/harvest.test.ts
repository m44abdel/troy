import { describe, expect, it } from 'vitest'
import { harvestArgs } from './harvest'

describe('harvestArgs', () => {
  it('read-only fork of the last conversation', () => {
    const args = harvestArgs('/troy/mcp.json')

    expect(args.slice(0, 3)).toEqual(['--continue', '--fork-session', '--print'])
    expect(args).toContain('/troy/mcp.json')
    expect(args.slice(args.indexOf('--allowedTools') + 1)).toEqual([
      'mcp__troy__knowledge_search',
      'mcp__troy__knowledge_propose',
      'Read',
      'Grep',
      'Glob'
    ])
  })
})
