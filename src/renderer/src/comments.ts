export interface ReviewComment {
  file: string
  /** react-diff-view change key, where the comment renders. */
  changeKey: string
  line: number
  /** True when the comment is on a removed line, so `line` is the old line number. */
  removed: boolean
  text: string
}

export function formatComments(comments: ReviewComment[]): string {
  const lines = comments.map(
    (c) => `- ${c.file}${c.removed ? ` (removed line ${c.line})` : `:${c.line}`}: ${c.text}`
  )
  return ['Review comments on your changes:', ...lines].join('\n')
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
