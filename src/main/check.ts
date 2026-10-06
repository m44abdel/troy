import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import type { CheckResult } from '../shared/types'
import { git } from './worktrees'

const exec = promisify(execFile)

const CHECK_FILE = '.troy/check'
const CHECK_TIMEOUT_MS = 10 * 60_000
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const TAIL_LINES = 40

const results = new Map<string, { fingerprint: string; result: CheckResult }>()
const inflight = new Map<string, Promise<CheckResult | null>>()

// ponytail: edits inside untracked files don't change this; hash their contents if that bites.
async function fingerprint(path: string): Promise<string> {
  const parts = await Promise.all([
    git(path, ['rev-parse', 'HEAD']).catch(() => ''),
    git(path, ['status', '--porcelain', '-z']),
    git(path, ['diff', 'HEAD', '--no-color', '--no-ext-diff']).catch(() => '')
  ])
  return createHash('sha1').update(parts.join('\0')).digest('hex')
}

const tail = (output: string): string => output.trim().split('\n').slice(-TAIL_LINES).join('\n')

async function execute(path: string): Promise<CheckResult> {
  const ranAt = Date.now()
  try {
    const { stdout } = await exec('/bin/sh', ['-c', `sh ${CHECK_FILE} 2>&1`], {
      cwd: path,
      timeout: CHECK_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES
    })
    return { ok: true, output: tail(stdout), ranAt }
  } catch (err) {
    const { stdout, killed, message } = err as {
      stdout?: string
      killed?: boolean
      message: string
    }
    const note = killed ? `\n(stopped after ${CHECK_TIMEOUT_MS / 60_000} minutes)` : ''
    return { ok: false, output: tail((stdout || message) + note), ranAt }
  }
}

async function check(path: string): Promise<CheckResult | null> {
  if (!existsSync(join(path, CHECK_FILE))) return null
  // Taken before the run: an edit made while the check runs must not inherit its result.
  const current = await fingerprint(path)
  const last = results.get(path)
  if (last?.fingerprint === current) return last.result
  const result = await execute(path)
  results.set(path, { fingerprint: current, result })
  return result
}

/** Runs the worktree's `.troy/check`, unless nothing changed since the last run. */
export function runCheck(path: string): Promise<CheckResult | null> {
  const pending = inflight.get(path)
  if (pending) return pending
  const run = check(path).finally(() => inflight.delete(path))
  inflight.set(path, run)
  return run
}
