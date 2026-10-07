import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseMail, sendMail, watchMail, type Mail } from './mail'

const dir = (): string => realpathSync(mkdtempSync(join(tmpdir(), 'troy-mail-')))

describe('mail', () => {
  it('delivers sent and already-waiting messages once, then removes them', async () => {
    const box = dir()
    await sendMail(box, { from: '/a', fromBranch: 'a', to: '/b', text: 'waiting since before' })
    const got: Mail[] = []
    const stop = watchMail(box, (m) => got.push(m))
    await sendMail(box, { from: '/a', fromBranch: 'a', to: '/b', text: 'hello b' })

    await vi.waitFor(() =>
      expect(got.map((m) => m.text)).toEqual(['waiting since before', 'hello b'])
    )
    expect(readdirSync(box)).toEqual([])
    stop()
  })

  it('refuses empty or oversized messages and drops junk files', async () => {
    const box = dir()
    await expect(
      sendMail(box, { from: '/a', fromBranch: null, to: '/b', text: ' ' })
    ).rejects.toThrow('empty')
    await expect(
      sendMail(box, { from: '/a', fromBranch: null, to: '/b', text: 'x'.repeat(9000) })
    ).rejects.toThrow('under')
    expect(parseMail('{"from":"/a"}')).toBeNull()
    expect(parseMail('not json')).toBeNull()

    writeFileSync(join(box, '1-junk.json'), '{"nope":true}')
    const got: Mail[] = []
    const stop = watchMail(box, (m) => got.push(m))
    await vi.waitFor(() => expect(readdirSync(box)).toEqual([]))
    expect(got).toEqual([])
    stop()
  })
})
