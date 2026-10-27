import { createHash } from 'crypto'
import { ipcMain } from 'electron'
import { readFile } from 'fs/promises'
import { userInfo } from 'os'
import { join } from 'path'
import type { ClaudeUsage } from '../shared/types'
import { claudeHome } from './context'
import { run } from './worktrees'

// Anthropic's endpoint behind Claude Code's /usage. It isn't documented and may change; the
// meter then hides.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const USAGE_TIMEOUT_MS = 10_000
// macOS may ask once whether Troy can read the item; this leaves time to answer.
const KEYCHAIN_TIMEOUT_MS = 60_000
const SERVICE = 'Claude Code-credentials'
const ACCOUNT_FALLBACK = 'claude-code-user'
// Between any epoch in seconds and any in ms, so it tells them apart.
const MS_EPOCH = 10_000_000_000

/** Claude Code keeps a separate keychain item per CLAUDE_CONFIG_DIR. */
export const claudeService = (configDir?: string): string =>
  configDir
    ? `${SERVICE}-${createHash('sha256').update(configDir.normalize('NFC')).digest('hex').slice(0, 8)}`
    : SERVICE

/** Claude Code stores the item under the login name, unless it has characters it rejects. */
export const keychainAccount = (user: string): string =>
  /^[a-zA-Z0-9._-]+$/.test(user) ? user : ACCOUNT_FALLBACK

/** The OAuth access token, or null when there is none or it has expired. */
export function parseCredentials(raw: string, now = Date.now()): string | null {
  try {
    const oauth = JSON.parse(raw)?.claudeAiOauth
    if (typeof oauth?.accessToken !== 'string' || !oauth.accessToken) return null
    return typeof oauth.expiresAt === 'number' && oauth.expiresAt <= now ? null : oauth.accessToken
  } catch {
    return null
  }
}

function resetTime(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : v
  if (typeof n === 'number') return Number.isFinite(n) ? (n > MS_EPOCH ? n : n * 1000) : null
  const at = typeof n === 'string' ? Date.parse(n) : NaN
  return Number.isNaN(at) ? null : at
}

export function parseUsage(json: unknown): ClaudeUsage | null {
  const w = (json as { five_hour?: Record<string, unknown> } | null)?.five_hour
  const percent = w?.utilization ?? w?.used_percentage
  if (typeof percent !== 'number') return null
  return { percent, resetsAt: resetTime(w?.resets_at) }
}

async function readToken(): Promise<string | null> {
  const configDir = process.env.CLAUDE_CONFIG_DIR
  if (process.platform === 'darwin') {
    const args = [
      'find-generic-password',
      '-s',
      claudeService(configDir),
      '-a',
      keychainAccount(userInfo().username),
      '-w'
    ]
    const raw = await run('security', args, '/', { timeout: KEYCHAIN_TIMEOUT_MS }).catch(() => null)
    const token = raw && parseCredentials(raw)
    if (token) return token
  }
  const file = await readFile(join(claudeHome(), '.credentials.json'), 'utf8').catch(() => null)
  return file ? parseCredentials(file) : null
}

/** Claude's 5-hour usage, or null without a Claude login. The token never leaves this process. */
async function claudeUsage(): Promise<ClaudeUsage | null> {
  const token = await readToken()
  if (!token) return null
  const response = await fetch(USAGE_URL, {
    headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
    signal: AbortSignal.timeout(USAGE_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`Anthropic answered ${response.status}`)
  return parseUsage(await response.json())
}

export function registerUsage(): void {
  ipcMain.handle('usage:get', () =>
    claudeUsage().catch((err) => {
      console.warn('Could not read Claude usage:', (err as Error).message)
      return null
    })
  )
}
