import { useCallback, useEffect, useState } from 'react'
import { shellQuote } from '../../shared/shell'
import type { Repo, SessionSummary, WorktreeView } from '../../shared/types'
import { Icon } from './icons'
import { requestTab } from './terminals'
import { timeAgo } from './timeAgo'
import { useStored } from './useStored'
import { AgentBadge } from './WorktreeCard'

type Scope = 'workspace' | 'project' | 'all'

const SCOPES: Array<[Scope, string]> = [
  ['workspace', 'Workspace'],
  ['project', 'Project'],
  ['all', 'All']
]

// The id goes into a command typed into a shell.
const SAFE_ID = /^[\w-]+$/

const isScope = (v: unknown): v is Scope => SCOPES.some(([s]) => s === v)
const basename = (path: string): string => path.split('/').filter(Boolean).pop() ?? path
const within = (cwd: string, dir: string): boolean => cwd === dir || cwd.startsWith(`${dir}/`)

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

const resumeCommand = (s: SessionSummary): string =>
  s.agent === 'claude' ? `claude --resume ${s.id}` : `codex resume ${s.id}`

interface Props {
  /** This worktree. */
  path: string
  repos: Repo[]
  visible: boolean
  /** Shows a worktree, e.g. the one a session was just resumed in. */
  onOpenWorktree: (path: string) => void
}

/** Past agent sessions from Claude Code's and Codex's own logs, like Orca's indexed history. */
export function SessionsPane({ path, repos, visible, onOpenWorktree }: Props): React.JSX.Element {
  const [found, setFound] = useState<{ sessions: SessionSummary[]; scanned: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [scope, setScope] = useStored<Scope>('troy.sessionScope', 'workspace', isScope)
  const [query, setQuery] = useState('')

  const load = useCallback(
    () =>
      window.api.sessions().then((r) => {
        if ('error' in r) return setError(r.error)
        setError(null)
        setFound(r)
      }),
    []
  )
  useEffect(() => {
    if (!visible) return
    void load()
    // A session that ran while you were away shows up when you come back.
    const onFocus = (): void => void load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [visible, load])

  const worktrees = repos.flatMap((r) => r.worktrees)
  const worktreeOf = (cwd: string): WorktreeView | undefined =>
    worktrees.find((w) => within(cwd, w.path))
  const repoOf = (cwd: string): Repo | undefined =>
    repos.find((r) => r.worktrees.some((w) => within(cwd, w.path)))
  const here = repoOf(path)

  const inScope = (s: SessionSummary): boolean =>
    scope === 'all' ||
    (scope === 'project' ? repoOf(s.cwd) === here : worktreeOf(s.cwd)?.path === path)
  const needle = query.trim().toLowerCase()
  const matches = (s: SessionSummary): boolean =>
    !needle || `${s.title} ${s.preview?.text ?? ''}`.toLowerCase().includes(needle)
  const all = found?.sessions ?? []
  const shown = all.filter((s) => inScope(s) && matches(s))
  const groups = Map.groupBy(shown, (s) => basename(repoOf(s.cwd)?.path ?? s.cwd))

  // Resumes in a new tab of its worktree; a session from elsewhere gets its command copied.
  const resume = (s: SessionSummary): void => {
    if (!SAFE_ID.test(s.id)) return
    const command = resumeCommand(s)
    const wt = worktreeOf(s.cwd)
    if (wt && wt.path === s.cwd) {
      requestTab(wt.path, { kind: 'command', title: s.title || 'Session', command })
      return onOpenWorktree(wt.path)
    }
    void navigator.clipboard.writeText(`cd ${shellQuote(s.cwd)} && ${command}`)
    setNotice(`Copied the command to resume it in ${basename(s.cwd)}.`)
  }

  return (
    <div className="sessions-pane">
      <header className="sessions-head">
        <div>
          <strong>Agents</strong>
          <span className="muted">Indexed history</span>
        </div>
        <button className="icon-button" aria-label="Refresh" onClick={() => void load()}>
          <Icon name="refresh" size={14} />
        </button>
      </header>
      <div className="sessions-controls">
        <div className="segmented" role="radiogroup" aria-label="Sessions from">
          {SCOPES.map(([s, label]) => (
            <button key={s} role="radio" aria-checked={scope === s} onClick={() => setScope(s)}>
              {label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sessions"
          aria-label="Search sessions"
        />
      </div>
      <div className="sessions-meta">
        <span>
          {found ? (
            <>
              <Icon name="check" size={12} /> Scanned {found.scanned} files
            </>
          ) : (
            'Scanning…'
          )}
        </span>
        <span>
          {shown.length} of {all.length} sessions · Last updated
        </span>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="sessions-body">
        {found && !shown.length && <p className="muted">No sessions here yet.</p>}
        {[...groups].map(([name, list]) => (
          <section key={name}>
            <h4 className="session-group">
              {name} <span className="count">{list.length}</span>
            </h4>
            {list.map((s) => (
              <button
                key={`${s.agent}:${s.id}`}
                className="session-row"
                title="Resume this session"
                onClick={() => resume(s)}
              >
                <span className="session-title">{s.title || 'Untitled session'}</span>
                {s.preview && (
                  <span className="session-preview">
                    <b>{s.preview.who === 'you' ? 'You' : 'Agent'}:</b> {s.preview.text}
                  </span>
                )}
                <span className="session-meta">
                  <AgentBadge agent={s.agent} />
                  {[
                    plural(s.messages, 'msg'),
                    s.subagents > 0 && plural(s.subagents, 'subagent'),
                    timeAgo(s.updatedAt)
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
