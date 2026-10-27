export interface Worktree {
  path: string
  branch: string | null
  primary: boolean
}

export interface WorktreeView extends Worktree {
  agent: string
  /** Appended to the agent's command line, e.g. to load Troy's MCP server. */
  agentArgs: string
  /** Added on launch to continue the worktree's last conversation; empty if there is none. */
  resume: string
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
  /** First message for the agent. */
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
  /** Vim keys in the sidebar and diff. */
  vim: boolean
}

/** The outcome of a worktree's `.troy/check`. */
export interface CheckResult {
  ok: boolean
  /** The last lines of stdout and stderr together. */
  output: string
  ranAt: number
}

/** A message one worktree's agent sent to another's. */
export interface Mail {
  from: string
  fromBranch: string | null
  to: string
  text: string
  sentAt: string
}

/** An agent asking Troy to start another agent in a new worktree. */
export interface SpawnRequest {
  from: string
  repo: string
  branch: string
  /** null runs the requester's own agent. */
  agent: string | null
  prompt: string
  sentAt: string
}

export interface ReviewComment {
  file: string
  /** react-diff-view change key, where the comment renders. */
  changeKey: string
  line: number
  /** The comment sits on a removed line; `line` is then the old line number. */
  removed: boolean
  text: string
}

/** An open PR that asks for your review. */
export interface PullRequest {
  number: number
  title: string
  url: string
  updatedAt: string
  /** "owner/name" on GitHub. */
  slug: string
  author: string
  /** The local clone Troy knows for it, or null when it has none. */
  repo: string | null
}

export interface ReviewMeta {
  number: number
  slug: string
  title: string
  body: string
  url: string
  author: string
  base: string
}

export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'

/** A prompt that starts an agent in a fresh worktree on a schedule. */
export interface Automation {
  id: string
  name: string
  repo: string
  /** Five-field cron, local time. */
  schedule: string
  agent: string
  prompt: string
}

/** One commit on a worktree's branch, as Source Control lists it. */
export interface Commit {
  hash: string
  subject: string
  /** Relative, e.g. "2 hours ago". */
  when: string
}

export type CheckState = 'pass' | 'fail' | 'pending' | 'skipped'

export interface PrCheck {
  name: string
  state: CheckState
  url?: string
}

export interface PrComment {
  author: string
  body: string
  createdAt: string
}

/** The pull request of a worktree's branch. */
export interface PrStatus {
  number: number
  title: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  url: string
  updatedAt: string
  isDraft: boolean
  /** MERGEABLE, CONFLICTING or UNKNOWN, as GitHub reports it. */
  mergeable: string
  checks: PrCheck[]
  comments: PrComment[]
}

export type MergeMethod = 'squash' | 'merge' | 'rebase'

export interface MergeOptions {
  allowed: MergeMethod[]
  preferred: MergeMethod
}
