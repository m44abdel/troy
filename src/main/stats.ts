import { app, ipcMain, powerSaveBlocker } from 'electron'
import type { AwakeMode, Stats } from '../shared/types'
import { livePtys } from './pty'
import { run } from './worktrees'

const PS_TIMEOUT_MS = 5000

interface Proc {
  pid: number
  ppid: number
  /** KB */
  rss: number
}

/** `ps -eo pid=,ppid=,rss=`. */
export const parsePs = (out: string): Proc[] =>
  out
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((cols) => cols.length === 3 && cols.every(Number.isFinite))
    .map(([pid, ppid, rss]) => ({ pid, ppid, rss }))

function tree(procs: Proc[], root: number): Set<number> {
  const pids = new Set([root])
  // Parents come before children in ps, but not always; repeat until nothing new joins.
  for (let grew = true; grew;) {
    grew = false
    for (const p of procs)
      if (pids.has(p.ppid) && !pids.has(p.pid)) {
        pids.add(p.pid)
        grew = true
      }
  }
  return pids
}

/** KB held by `root` and every process under it. */
export const treeRss = (procs: Proc[], root: number): number => {
  const pids = tree(procs, root)
  return procs.filter((p) => pids.has(p.pid)).reduce((kb, p) => kb + p.rss, 0)
}

/** `lsof -F pn` lists a pid line, then one name line per socket, e.g. "n*:3000". */
export function parseListening(out: string): Array<{ pid: number; port: number }> {
  const seen = new Set<string>()
  const found: Array<{ pid: number; port: number }> = []
  let pid = 0
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    const port = line.startsWith('n') ? Number(line.slice(line.lastIndexOf(':') + 1)) : NaN
    if (!pid || !Number.isInteger(port) || seen.has(`${pid}:${port}`)) continue
    seen.add(`${pid}:${port}`)
    found.push({ pid, port })
  }
  return found
}

/** Listening ports started from a worktree's terminals, with that worktree. */
export function portsOf(
  procs: Proc[],
  listening: Array<{ pid: number; port: number }>,
  shells: Array<{ pid: number; cwd: string }>
): Stats['ports'] {
  const ports = new Map<number, string>()
  for (const shell of shells) {
    const pids = tree(procs, shell.pid)
    for (const l of listening)
      if (pids.has(l.pid) && !ports.has(l.port)) ports.set(l.port, shell.cwd)
  }
  return [...ports].map(([port, path]) => ({ port, path })).sort((a, b) => a.port - b.port)
}

async function collect(): Promise<Stats> {
  const shells = livePtys()
  const [ps, lsof] = await Promise.all([
    run('ps', ['-eo', 'pid=,ppid=,rss='], '/', { timeout: PS_TIMEOUT_MS }),
    // lsof exits 1 when nothing listens.
    run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn'], '/', {
      timeout: PS_TIMEOUT_MS,
      okCodes: [1]
    })
  ])
  const procs = parsePs(ps)
  const appKb = app.getAppMetrics().reduce((kb, m) => kb + m.memory.workingSetSize, 0)
  const shellKb = shells.reduce((kb, s) => kb + treeRss(procs, s.pid), 0)
  return {
    memoryMb: Math.round((appKb + shellKb) / 1024),
    terminals: shells.length,
    ports: portsOf(procs, parseListening(lsof), shells)
  }
}

let blocker: number | null = null

/** Keeps the Mac from sleeping while `on`, or in `auto` while an agent works. */
function stayAwake(mode: unknown, working: unknown): void {
  const wanted = mode === 'on' || (mode === 'auto' && working === true)
  if (wanted && blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension')
  if (!wanted && blocker !== null) {
    powerSaveBlocker.stop(blocker)
    blocker = null
  }
}

export const isAwakeMode = (v: unknown): v is AwakeMode => v === 'off' || v === 'auto' || v === 'on'

export function registerStats(): void {
  ipcMain.handle('stats:get', () =>
    collect().catch((err) => {
      console.warn('Could not read process stats:', (err as Error).message)
      return null
    })
  )
  ipcMain.on('awake:set', (_e, mode, working) => isAwakeMode(mode) && stayAwake(mode, working))
}
