import { describe, expect, it } from 'vitest'
import { withoutSessionMarkers } from './env'

describe('withoutSessionMarkers', () => {
  it('drops the markers of a Claude Code session Troy was launched from, keeping settings', () => {
    const env = {
      PATH: '/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_SESSION_ID: 'abc',
      CLAUDE_CODE_SESSION_ATTENDED: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/s',
      CLAUDE_CODE_MESSAGING_TOKEN: 't',
      CLAUDE_CODE_EXECPATH: '/x',
      CLAUDE_CODE_SSE_PORT: '1',
      CLAUDE_PID: '1',
      CLAUDE_CODE_NO_FLICKER: '1',
      CLAUDE_CODE_SCROLL_SPEED: '3'
    }

    expect(withoutSessionMarkers(env)).toEqual({
      PATH: '/bin',
      CLAUDE_CODE_NO_FLICKER: '1',
      CLAUDE_CODE_SCROLL_SPEED: '3'
    })
  })
})
