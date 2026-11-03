import { describe, expect, it } from 'vitest'
import { noteSaver, type SaveState } from './noteSaver'

type Result = { error?: string }

// A write whose result the test decides, so saves can finish out of step with typing.
function harness(): {
  saver: ReturnType<typeof noteSaver>
  sent: string[]
  finish: (i: number, result: Result | Error) => Promise<void>
  states: SaveState[]
} {
  const sent: string[] = []
  const settle: Array<(r: Result | Error) => void> = []
  const states: SaveState[] = []
  const write = (text: string): Promise<Result> => {
    sent.push(text)
    return new Promise((resolve, reject) =>
      settle.push((r) => (r instanceof Error ? reject(r) : resolve(r)))
    )
  }
  const saver = noteSaver(write, (s) => states.push(s))
  const finish = async (i: number, result: Result | Error): Promise<void> => {
    settle[i](result)
    await new Promise((r) => setTimeout(r, 0))
  }
  return { saver, sent, finish, states }
}

describe('noteSaver', () => {
  it('sends the latest edit once', async () => {
    const { saver, sent, finish, states } = harness()
    saver.edit('a')
    saver.edit('ab')
    saver.flush()
    saver.flush()
    expect(sent).toEqual(['ab'])
    await finish(0, {})
    expect(states).toEqual(['saving', 'saved'])
  })

  it('sends a second edit without waiting for the first write', () => {
    const { saver, sent } = harness()
    saver.edit('a')
    saver.flush()
    saver.edit('ab')
    saver.flush()
    expect(sent).toEqual(['a', 'ab'])
  })

  it('keeps a failed save for the next flush', async () => {
    const { saver, sent, finish, states } = harness()
    saver.edit('a')
    saver.flush()
    await finish(0, { error: 'disk full' })
    expect(states.at(-1)).toEqual({ error: 'disk full' })
    saver.flush()
    expect(sent).toEqual(['a', 'a'])
  })

  it('treats a write that throws as a failed save', async () => {
    const { saver, sent, finish, states } = harness()
    saver.edit('a')
    saver.flush()
    await finish(0, new Error('channel closed'))
    expect(states.at(-1)).toEqual({ error: 'channel closed' })
    saver.flush()
    expect(sent).toEqual(['a', 'a'])
  })

  it('never resends older text once newer text has gone out', async () => {
    const { saver, sent, finish, states } = harness()
    saver.edit('a')
    saver.flush()
    saver.edit('ab')
    saver.flush()
    await finish(0, { error: 'busy' })
    await finish(1, {})
    saver.flush()
    expect(sent).toEqual(['a', 'ab'])
    expect(states.at(-1)).toBe('saved')
  })

  it('a failed save does not drop text typed after it', async () => {
    const { saver, sent, finish } = harness()
    saver.edit('a')
    saver.flush()
    saver.edit('ab')
    await finish(0, { error: 'busy' })
    saver.flush()
    expect(sent).toEqual(['a', 'ab'])
  })
})
