import { describe, expect, it } from 'vitest'
import { parseChecks, parseMergeOptions, parsePr } from './github'

describe('parseChecks', () => {
  it('reads GitHub Actions runs by status and conclusion', () => {
    const rollup = [
      {
        __typename: 'CheckRun',
        name: 'test',
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
        detailsUrl: 'u1'
      },
      {
        __typename: 'CheckRun',
        name: 'lint',
        status: 'COMPLETED',
        conclusion: 'FAILURE',
        detailsUrl: 'u2'
      },
      {
        __typename: 'CheckRun',
        name: 'e2e',
        status: 'IN_PROGRESS',
        conclusion: '',
        detailsUrl: 'u3'
      },
      { __typename: 'CheckRun', name: 'deploy', status: 'COMPLETED', conclusion: 'SKIPPED' }
    ]
    expect(parseChecks(rollup)).toEqual([
      { name: 'test', state: 'pass', url: 'u1' },
      { name: 'lint', state: 'fail', url: 'u2' },
      { name: 'e2e', state: 'pending', url: 'u3' },
      { name: 'deploy', state: 'skipped', url: undefined }
    ])
  })

  it('reads commit statuses from other CI services', () => {
    const rollup = [
      { __typename: 'StatusContext', context: 'ci/circle', state: 'PENDING', targetUrl: 'u' },
      { __typename: 'StatusContext', context: 'vercel', state: 'ERROR' }
    ]
    expect(parseChecks(rollup)).toEqual([
      { name: 'ci/circle', state: 'pending', url: 'u' },
      { name: 'vercel', state: 'fail', url: undefined }
    ])
  })

  it('treats a missing rollup as no checks', () => {
    expect(parseChecks(null)).toEqual([])
  })
})

describe('parsePr', () => {
  it('keeps the fields the PR tab shows', () => {
    const pr = parsePr({
      number: 3,
      title: 'Greyscale UI',
      state: 'OPEN',
      url: 'https://github.com/o/r/pull/3',
      updatedAt: '2026-10-27T15:56:25Z',
      isDraft: false,
      mergeable: 'MERGEABLE',
      statusCheckRollup: [],
      comments: [
        { author: { login: 'ana' }, body: 'Looks good', createdAt: '2026-10-27T16:00:00Z' }
      ]
    })
    expect(pr).toEqual({
      number: 3,
      title: 'Greyscale UI',
      state: 'OPEN',
      url: 'https://github.com/o/r/pull/3',
      updatedAt: '2026-10-27T15:56:25Z',
      isDraft: false,
      mergeable: 'MERGEABLE',
      checks: [],
      comments: [{ author: 'ana', body: 'Looks good', createdAt: '2026-10-27T16:00:00Z' }]
    })
  })

  it('rejects output that is not a PR', () => {
    expect(() => parsePr({ title: 'no number' })).toThrow()
  })
})

describe('parseMergeOptions', () => {
  it("offers the repo's allowed methods with its default first choice", () => {
    expect(
      parseMergeOptions({
        squashMergeAllowed: true,
        mergeCommitAllowed: false,
        rebaseMergeAllowed: true,
        viewerDefaultMergeMethod: 'REBASE'
      })
    ).toEqual({ allowed: ['squash', 'rebase'], preferred: 'rebase' })
  })

  it('falls back to the first allowed method when the default is not allowed', () => {
    expect(
      parseMergeOptions({
        squashMergeAllowed: true,
        mergeCommitAllowed: false,
        rebaseMergeAllowed: false,
        viewerDefaultMergeMethod: 'MERGE'
      })
    ).toEqual({ allowed: ['squash'], preferred: 'squash' })
  })
})
