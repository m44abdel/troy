import { describe, expect, it } from 'vitest'
import { dueAt, parseAutomation, runBranch } from './automation'

const valid = {
  id: '1',
  name: 'Watch the deploy',
  repo: '/r',
  schedule: '0 9 * * *',
  agent: 'claude',
  prompt: 'Check the logs'
}

describe('parseAutomation', () => {
  it('trims a valid automation', () => {
    expect(parseAutomation({ ...valid, name: ' Watch the deploy ' })).toEqual(valid)
  })

  it('says which field is wrong', () => {
    expect(() => parseAutomation({ ...valid, prompt: ' ' })).toThrow('prompt is missing')
    expect(() => parseAutomation({ ...valid, agent: 'a\nb' })).toThrow('one command line')
    expect(() => parseAutomation({ ...valid, schedule: 'daily' })).toThrow('five fields')
    expect(() => parseAutomation(null)).toThrow('id is missing')
  })
})

describe('dueAt', () => {
  it('only the ones due that minute', () => {
    const hourly = { ...valid, id: '2', schedule: '0 * * * *' }
    expect(dueAt([valid, hourly], new Date(2026, 9, 9, 9, 0)).map((a) => a.id)).toEqual(['1', '2'])
    expect(dueAt([valid, hourly], new Date(2026, 9, 9, 10, 0)).map((a) => a.id)).toEqual(['2'])
    expect(dueAt([valid, hourly], new Date(2026, 9, 9, 10, 1))).toEqual([])
  })
})

describe('runBranch', () => {
  it('slug plus minute stamp', () => {
    expect(runBranch('Watch the deploy!', new Date(2026, 9, 9, 9, 5))).toBe(
      'auto/watch-the-deploy-20261009-0905'
    )
  })

  it('falls back to "run" when nothing slugs', () => {
    expect(runBranch('!!!', new Date(2026, 0, 2, 3, 4))).toBe('auto/run-20260102-0304')
  })
})
