export interface Worktree {
  path: string
  branch: string | null
  primary: boolean
}

export interface WorktreeView extends Worktree {
  agent: string
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
}

export interface ContextUsage {
  used: number
  window: number
  model: string | null
}
