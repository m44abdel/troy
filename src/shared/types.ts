export interface Worktree {
  path: string
  branch: string | null
  primary: boolean
}

export interface WorktreeView extends Worktree {
  agent: string
  /** Appended to the agent's command line, e.g. to load Troy's MCP server. */
  agentArgs: string
  /** What the session is for: the first line of its initial prompt. */
  title?: string
  port?: number
}

export interface Repo {
  path: string
  worktrees: WorktreeView[]
  error?: string
}

export interface ReposResult {
  repos: Repo[]
  error?: string
}

export interface CreateRequest {
  branch: string
  base: string
  agent: string
  /** Optional first message for the agent. */
  prompt?: string
}

export interface ContextUsage {
  used: number
  window: number
  model: string | null
}

/** One fact in `.troy/knowledge.md`. */
export interface KnowledgeEntry {
  fact: string
  /** `path:line`, a commit hash or `session:<id>`. */
  source: string
  /** YYYY-MM-DD */
  date: string
  author: string
}

/** A fact an agent proposed, waiting for a person to approve it. */
export interface Proposal extends KnowledgeEntry {
  id: string
}

export interface Knowledge {
  /** `stale` when the cited file has commits after the entry's date. */
  entries: Array<KnowledgeEntry & { stale: boolean }>
  proposals: Proposal[]
}

export interface Settings {
  /** Vim keys in the sidebar and diff; never in terminals. */
  vim: boolean
}
