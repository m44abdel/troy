import { describe, expect, it } from 'vitest'
import { issueBranch, issuePrompt } from './tasks'

const issue = {
  number: 12,
  title: 'Totals are off by a cent (again!)',
  url: 'https://github.com/o/r/issues/12',
  updatedAt: '',
  labels: [],
  body: 'Seen on carts with 3 items.'
}

describe('issueBranch', () => {
  it('names the branch after the issue', () => {
    expect(issueBranch(issue)).toBe('issue-12-totals-are-off-by-a-cent-again')
  })

  it('keeps long titles short and copes with no usable words', () => {
    expect(issueBranch({ ...issue, title: 'a'.repeat(80) })).toBe(`issue-12-${'a'.repeat(40)}`)
    expect(issueBranch({ ...issue, title: '!!!' })).toBe('issue-12')
  })
})

describe('issuePrompt', () => {
  it('starts with the issue, so the worktree is titled after it', () => {
    expect(issuePrompt(issue)).toBe(
      'Work on issue #12: Totals are off by a cent (again!)\n\n' +
        'https://github.com/o/r/issues/12\n\nSeen on carts with 3 items.'
    )
  })
})
