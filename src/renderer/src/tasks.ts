import type { Issue } from '../../shared/types'

const MAX_SLUG = 40
// The agent can read the rest with `gh issue view`.
const MAX_BODY = 4000

export function issueBranch(issue: Issue): string {
  const slug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_SLUG)
    .replace(/^-+|-+$/g, '')
  return slug ? `issue-${issue.number}-${slug}` : `issue-${issue.number}`
}

export const issuePrompt = (issue: Issue): string =>
  [
    `Work on issue #${issue.number}: ${issue.title}`,
    issue.url,
    issue.body.trim().slice(0, MAX_BODY)
  ]
    .filter(Boolean)
    .join('\n\n')
