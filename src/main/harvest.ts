import { HARVEST_PROMPT } from '../shared/harvest'
import { commandName } from '../shared/shell'
import { resumeFlag } from './context'
import { readKnowledge } from './knowledge'
import { configPath } from './mcp-config'
import { run } from './worktrees'

const HARVEST_TIMEOUT_MS = 10 * 60_000

// --fork-session leaves the original conversation untouched; the agent may only read code
// and talk to Troy's knowledge tools.
export const harvestArgs = (mcpConfig: string): string[] => [
  '--continue',
  '--fork-session',
  '--print',
  HARVEST_PROMPT,
  '--mcp-config',
  mcpConfig,
  '--allowedTools',
  'mcp__troy__knowledge_search',
  'mcp__troy__knowledge_propose',
  'Read',
  'Grep',
  'Glob'
]

/**
 * Has a worktree's last (finished) Claude Code conversation propose what it learned.
 * Returns how many proposals it added to the review queue.
 */
export async function harvest(path: string, agent: string): Promise<number> {
  if (commandName(agent) !== 'claude')
    throw new Error('Only Claude Code conversations can be harvested so far.')
  if (!resumeFlag(agent, path))
    throw new Error('This worktree has no conversation to look back on.')
  const before = (await readKnowledge(path)).proposals.length
  await run(agent.trim().split(/\s+/)[0], harvestArgs(configPath()), path, {
    timeout: HARVEST_TIMEOUT_MS
  })
  return (await readKnowledge(path)).proposals.length - before
}
