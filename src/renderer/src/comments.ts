import type { ReviewComment } from '../../shared/types'

export type { ReviewComment }

export function formatComments(
  comments: ReviewComment[],
  heading = 'Review comments on your changes:'
): string {
  const lines = comments.map(
    (c) => `- ${c.file}${c.removed ? ` (removed line ${c.line})` : `:${c.line}`}: ${c.text}`
  )
  return [heading, ...lines].join('\n')
}

export const formatCheckFailure = (output: string): string =>
  ['.troy/check failed. Fix it and make sure it passes:', '```', output, '```'].join('\n')

/** How a message from another worktree's agent reads in the receiving session. */
export const formatMail = (from: string, text: string): string =>
  [
    `[Troy] Message from the agent in ${from}:`,
    text,
    `(Reply with the agent_message tool, to: "${from}". You don't have to reply.)`
  ].join('\n')
