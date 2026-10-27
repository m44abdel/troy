import { useEffect, useState } from 'react'
import type { Issue, OpenPr } from '../../shared/types'
import { Icon } from './icons'
import { ReviewList } from './ReviewList'
import { timeAgo } from './timeAgo'

const basename = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

interface RepoTasks {
  issues?: Issue[]
  prs?: OpenPr[]
  error?: string
}

interface Props {
  repos: string[]
  /** Starts a worktree for an issue. */
  onStart: (repo: string, issue: Issue) => void
  onClose: () => void
}

/** Open issues and pull requests of every repo, from GitHub, like Orca's Tasks. */
export function TasksPage({ repos, onStart, onClose }: Props): React.JSX.Element {
  const [tasks, setTasks] = useState<Record<string, RepoTasks>>({})
  const [query, setQuery] = useState('')
  const repoKey = repos.join('\n')

  useEffect(() => {
    for (const repo of repoKey.split('\n').filter(Boolean))
      void window.api.tasks(repo).then((t) => setTasks((all) => ({ ...all, [repo]: t })))
  }, [repoKey])

  const needle = query.trim().toLowerCase()
  const matches = (title: string, n: number): boolean =>
    !needle || title.toLowerCase().includes(needle) || `#${n}` === needle

  return (
    <div className="tasks-page">
      <header className="tasks-head">
        <h2>Tasks</h2>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter issues and pull requests"
          aria-label="Filter tasks"
        />
        <button className="icon-button" aria-label="Close tasks" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </header>
      <ReviewList />
      {repos.map((repo) => {
        const t = tasks[repo]
        const issues = t?.issues?.filter((i) => matches(i.title, i.number)) ?? []
        const prs = t?.prs?.filter((p) => matches(p.title, p.number)) ?? []
        return (
          <section key={repo} className="tasks-repo">
            <h3>{basename(repo)}</h3>
            {!t && <p className="muted">Loading…</p>}
            {t?.error && <p className="muted">GitHub isn&apos;t reachable for this repo.</p>}
            {t && !t.error && !issues.length && !prs.length && (
              <p className="muted">Nothing open.</p>
            )}
            {issues.map((issue) => (
              <div key={`i${issue.number}`} className="task-row">
                <Icon name="circle" size={13} />
                <a href={issue.url} target="_blank" rel="noreferrer" className="task-title">
                  #{issue.number} {issue.title}
                </a>
                {issue.labels.map((l) => (
                  <span key={l} className="chip">
                    {l}
                  </span>
                ))}
                <span className="muted">{timeAgo(Date.parse(issue.updatedAt))}</span>
                <button className="secondary" onClick={() => onStart(repo, issue)}>
                  <Icon name="plus" size={13} />
                  Start
                </button>
              </div>
            ))}
            {prs.map((pr) => (
              <div key={`p${pr.number}`} className="task-row">
                <Icon name="pr" size={13} />
                <a href={pr.url} target="_blank" rel="noreferrer" className="task-title">
                  #{pr.number} {pr.title}
                </a>
                {pr.isDraft && <span className="chip">draft</span>}
                <span className="muted">
                  @{pr.author} · {timeAgo(Date.parse(pr.updatedAt))}
                </span>
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}
