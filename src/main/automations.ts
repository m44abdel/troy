// Scheduled prompts. Each due run asks for a worktree the same way agent_spawn does,
// so the window creates and starts it like any other spawned agent.
import { app, ipcMain } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { dueAt, parseAutomation, runBranch } from '../shared/automation'
import type { Automation } from '../shared/types'
import { requestSpawn } from './mail'
import { mailDir } from './mcp-config'

// ponytail: runs only while Troy is open, and a minute missed (asleep, closed) is skipped,
// not caught up. launchd or a remote host would be the upgrade.
const TICK_MS = 30_000

const automationsPath = (): string => join(app.getPath('userData'), 'automations.json')

export async function loadAutomations(): Promise<Automation[]> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(automationsPath(), 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
      console.error(`Unreadable ${automationsPath()}`, err)
    return []
  }
  if (!Array.isArray(raw)) return []
  return raw.flatMap((a) => {
    try {
      return [parseAutomation(a)]
    } catch (err) {
      console.warn('Skipped an automation:', (err as Error).message)
      return []
    }
  })
}

async function run(now: Date): Promise<void> {
  for (const a of dueAt(await loadAutomations(), now)) {
    await requestSpawn(mailDir(), {
      from: '',
      repo: a.repo,
      branch: runBranch(a.name, now),
      agent: a.agent,
      prompt: a.prompt
    }).catch((err) => console.error(`Could not start automation "${a.name}"`, err))
  }
}

export function registerAutomations(): void {
  ipcMain.handle('automations:get', loadAutomations)
  ipcMain.handle('automations:set', async (_e, list: unknown) => {
    if (!Array.isArray(list)) throw new Error('Expected a list of automations.')
    const parsed = list.map(parseAutomation)
    await writeFile(automationsPath(), JSON.stringify(parsed, null, 2))
    return parsed
  })

  // Ticks twice a minute so no minute is missed; each minute runs once.
  let lastMinute = -1
  const tick = (): void => {
    const now = new Date()
    const minute = Math.floor(now.getTime() / 60_000)
    if (minute === lastMinute) return
    lastMinute = minute
    void run(now)
  }
  setInterval(tick, TICK_MS)
  tick()
}
