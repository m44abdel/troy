import { describe, expect, it } from 'vitest'
import { parseListening, parsePs, portsOf, treeRss } from './stats'

// launchd(1) → zsh(100, a pty) → node(101) → esbuild(102); 200 is unrelated.
const PS = `    1     0  1000
  100     1  2000
  101   100 50000
  102   101  3000
  200     1  9999
`

describe('parsePs', () => {
  it('reads pid, parent and resident memory in KB', () => {
    expect(parsePs(PS)[1]).toEqual({ pid: 100, ppid: 1, rss: 2000 })
  })
})

describe('treeRss', () => {
  it("adds a shell's memory to everything it started", () => {
    expect(treeRss(parsePs(PS), 100)).toBe(55_000)
  })
})

describe('parseListening', () => {
  it('reads the port of each listening socket, once per process', () => {
    const lsof = 'p101\nn*:3100\nn[::1]:3100\nn127.0.0.1:5173\np200\nn*:631\n'
    expect(parseListening(lsof)).toEqual([
      { pid: 101, port: 3100 },
      { pid: 101, port: 5173 },
      { pid: 200, port: 631 }
    ])
  })
})

describe('portsOf', () => {
  it('credits a port to the worktree whose shell started the server, and ignores the rest', () => {
    const listening = [
      { pid: 102, port: 3100 },
      { pid: 200, port: 631 }
    ]
    expect(portsOf(parsePs(PS), listening, [{ pid: 100, cwd: '/work/shop.feat' }])).toEqual([
      { port: 3100, path: '/work/shop.feat' }
    ])
  })
})
