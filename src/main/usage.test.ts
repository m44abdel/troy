import { describe, expect, it } from 'vitest'
import { claudeService, keychainAccount, parseCredentials, parseUsage } from './usage'

describe('claudeService', () => {
  it('uses the default keychain item unless Claude Code has its own config folder', () => {
    expect(claudeService()).toBe('Claude Code-credentials')
    expect(claudeService('/Users/me/.claude-work')).toMatch(/^Claude Code-credentials-[0-9a-f]{8}$/)
  })
})

describe('keychainAccount', () => {
  it('falls back to the account Claude Code uses for names it rejects', () => {
    expect(keychainAccount('moheb')).toBe('moheb')
    expect(keychainAccount('first@example.com')).toBe('claude-code-user')
  })
})

describe('parseCredentials', () => {
  const NOW = 1_000_000
  it('returns the access token while it is valid', () => {
    const raw = JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: NOW + 1 } })
    expect(parseCredentials(raw, NOW)).toBe('tok')
  })

  it('gives nothing for an expired token or junk', () => {
    const raw = JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: NOW - 1 } })
    expect(parseCredentials(raw, NOW)).toBeNull()
    expect(parseCredentials('not json', NOW)).toBeNull()
    expect(parseCredentials('{}', NOW)).toBeNull()
  })
})

describe('parseUsage', () => {
  it("reads the 5-hour window's use and when it resets", () => {
    expect(
      parseUsage({ five_hour: { utilization: 31, resets_at: '2026-10-27T20:00:00Z' } })
    ).toEqual({ percent: 31, resetsAt: Date.parse('2026-10-27T20:00:00Z') })
  })

  it('takes reset times in seconds as well as milliseconds', () => {
    expect(parseUsage({ five_hour: { used_percentage: 5, resets_at: 1_793_000_000 } })).toEqual({
      percent: 5,
      resetsAt: 1_793_000_000_000
    })
  })

  it('gives nothing without a 5-hour window', () => {
    expect(parseUsage({ seven_day: { utilization: 3 } })).toBeNull()
  })
})
