import { describe, expect, it } from 'vitest'
import { harvestArgs } from './harvest'

describe('harvestArgs', () => {
  it('forks the last conversation and only lets it read and propose', () => {
    const args = harvestArgs('/troy/mcp.json')

    expect(args.slice(0, 3)).toEqual(['--continue', '--fork-session', '--print'])
    expect(args).toContain('/troy/mcp.json')
    // Variadic flags take every argument after them, so the tool list goes last.
    expect(args.slice(args.indexOf('--allowedTools') + 1)).toEqual([
      'mcp__troy__knowledge_search',
      'mcp__troy__knowledge_propose',
      'Read',
      'Grep',
      'Glob'
    ])
  })
})
