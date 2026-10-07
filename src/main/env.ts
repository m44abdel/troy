// Set by a running Claude Code session for its own children. When Troy is opened from
// one, they leak into every agent Troy starts, which then thinks it is a sub-session
// (no transcripts, wrong session id). User settings like CLAUDE_CODE_NO_FLICKER stay.
const SESSION_MARKERS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_PID'
]

export function withoutSessionMarkers<T extends Record<string, string | undefined>>(env: T): T {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !SESSION_MARKERS.includes(key))
  ) as T
}
