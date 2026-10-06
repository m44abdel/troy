import { readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { commandName } from '../shared/shell'
import { git } from './worktrees'

const START = '<!-- troy:knowledge -->'
const END = '<!-- /troy:knowledge -->'
const BLOCK = `${START}
## Shared knowledge

\`.troy/knowledge.md\` lists facts about this repository that a person approved, each with its source. Read it before exploring.

If the \`troy\` MCP server is available, \`knowledge_search\` searches the latest approved facts and flags entries whose source file changed since. To record a fact, call \`knowledge_propose\` with the fact and a source (\`path:line\`, a commit hash or \`session:<id>\`); a person reviews it first. Don't edit \`.troy/knowledge.md\` yourself.
${END}`

const FILES = ['CLAUDE.md', 'AGENTS.md']

/** Adds Troy's block, or refreshes it in place. Idempotent. */
export function upsertBlock(content: string): string {
  const start = content.indexOf(START)
  const end = content.indexOf(END, start)
  if (start !== -1 && end !== -1)
    return content.slice(0, start) + BLOCK + content.slice(end + END.length)
  return content.trim() ? `${content.trimEnd()}\n\n${BLOCK}\n` : `${BLOCK}\n`
}

const read = (path: string): Promise<string | null> => readFile(path, 'utf8').catch(() => null)

/** Points the agent at shared knowledge: its own instructions file plus any that already exist. */
export async function writeInstructions(worktree: string, agent: string): Promise<void> {
  const own = commandName(agent) === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'
  for (const name of FILES) {
    const current = await read(join(worktree, name))
    if (current === null && name !== own) continue
    const next = upsertBlock(current ?? '')
    if (next !== current) await writeFile(join(worktree, name), next)
  }
}

/**
 * Undoes writeInstructions where the block is the file's only uncommitted change,
 * so it alone never stops `git worktree remove`.
 */
export async function stripInstructions(worktree: string): Promise<void> {
  for (const name of FILES) {
    const current = await read(join(worktree, name))
    if (current === null) continue
    // run() trims output; files that don't end in exactly one newline just aren't stripped.
    const committed = await git(worktree, ['show', `HEAD:${name}`]).then(
      (text) => `${text}\n`,
      () => null
    )
    if (current === committed || current !== upsertBlock(committed ?? '')) continue
    if (committed === null) await rm(join(worktree, name))
    else await writeFile(join(worktree, name), committed)
  }
}
