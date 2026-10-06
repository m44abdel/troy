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
