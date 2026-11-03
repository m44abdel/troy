import { describe, expect, it } from 'vitest'
import { agentLogo } from './agentLogos'

describe('agentLogo', () => {
  it('has marks for Claude and Codex', () => {
    expect(agentLogo('claude')).toMatch(/^m4\.7144/)
    expect(agentLogo('codex')).toMatch(/^M8\.086/)
  })

  it('has none for other agents, or for names an object inherits', () => {
    expect(agentLogo('aider')).toBeUndefined()
    expect(agentLogo('constructor')).toBeUndefined()
  })
})
