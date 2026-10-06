import { useCallback, useEffect, useState } from 'react'
import type { AppAction } from '../../shared/keys'
import { isAlive, type AgentStatus } from '../../shared/status'
import type { ContextUsage, Repo } from '../../shared/types'
import { formatComments, type ReviewComment } from './comments'
import { CONTEXT_WARN_PERCENT, contextPercent, describeContext } from './context'
import { NewWorktree, type NewWorktreeRequest } from './NewWorktree'
import { MOD } from './platform'
import { agentId, focusTerminal, pasteToTerminal, shellId } from './terminals'
import { Workspace, type ColumnTab, type FirstRun } from './Workspace'

// ponytail: polls session logs; switch to fs.watch in main if this shows up in profiles.
const CONTEXT_POLL_MS = 5000

const basename = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

// Focus after React has shown a pane that may have been hidden.
const focusSoon = (id: string): void => void requestAnimationFrame(() => focusTerminal(id))

function App(): React.JSX.Element {
  const [repos, setRepos] = useState<Repo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [visited, setVisited] = useState<string[]>([])
  const [statuses, setStatuses] = useState<Record<string, AgentStatus>>({})
  const [firstRuns, setFirstRuns] = useState<Record<string, FirstRun>>({})
  const [showColumn, setShowColumn] = useState(true)
  const [tab, setTab] = useState<ColumnTab>('shell')
  const [contexts, setContexts] = useState<Record<string, ContextUsage | null>>({})
  const [comments, setComments] = useState<Record<string, ReviewComment[]>>({})
  const [dialogRepo, setDialogRepo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const worktrees = repos.flatMap((r) => r.worktrees)
  const current = worktrees.find((w) => w.path === selected) ?? worktrees[0]
  const currentRepo = repos.find((r) => current && r.worktrees.includes(current)) ?? repos[0]

  // Terminals mount on first view and then stay alive in the background.
  if (current && !visited.includes(current.path)) setVisited([...visited, current.path])

  useEffect(() => {
    window.api.listRepos().then(setRepos)
  }, [])

  const watched = worktrees.filter((wt) => visited.includes(wt.path))
  const watchKey = watched.map((wt) => `${wt.path}\0${wt.agent}`).join('\n')
  useEffect(() => {
    const targets = watchKey ? watchKey.split('\n').map((line) => line.split('\0')) : []
    const poll = (): void =>
      targets.forEach(([path, agent]) =>
        window.api
          .contextUsage(path, agent)
          .then((usage) => setContexts((c) => ({ ...c, [path]: usage })))
      )
    poll()
    const timer = setInterval(poll, CONTEXT_POLL_MS)
    return () => clearInterval(timer)
  }, [watchKey])

  useEffect(() => {
    if (current) focusTerminal(agentId(current.path))
  }, [current?.path]) // eslint-disable-line react-hooks/exhaustive-deps

  const addRepo = useCallback(async () => {
    const result = await window.api.addRepo()
    setRepos(result.repos)
    setError(result.error ?? null)
    const added = result.repos.find((r) => r.path === result.added)
    if (added?.worktrees[0]) setSelected(added.worktrees[0].path)
  }, [])

  const createWorktree = async (req: NewWorktreeRequest): Promise<string | null> => {
    if (!dialogRepo) return null
    const result = await window.api.createWorktree(dialogRepo, req)
    setRepos(result.repos)
    if (result.error || !result.path) return result.error ?? 'Could not create the worktree.'
    const path = result.path
    setFirstRuns((f) => ({ ...f, [path]: { prompt: req.prompt, setup: !!result.setup } }))
    setDialogRepo(null)
    setSelected(path)
    return null
  }

  const archive = useCallback(async () => {
    if (!current || !currentRepo || current.primary) return
    const result = await window.api.archiveWorktree(currentRepo.path, current.path)
    setRepos(result.repos)
    setError(result.error ?? null)
  }, [current, currentRepo])

  const sendComments = useCallback(
    (path: string) => {
      const pending = comments[path] ?? []
      if (!pending.length || !isAlive(statuses[path])) return
      pasteToTerminal(agentId(path), formatComments(pending))
      setComments((c) => ({ ...c, [path]: [] }))
      focusTerminal(agentId(path))
    },
    [comments, statuses]
  )

  const showTab = (name: ColumnTab): void => {
    setShowColumn(true)
    setTab(name)
  }

  useEffect(
    () =>
      window.api.onAction((action: AppAction) => {
        if (action === 'addRepo') return void addRepo()
        if (action === 'newWorktree') return currentRepo && setDialogRepo(currentRepo.path)
        if (action === 'toggleColumn') return setShowColumn((s) => !s)
        if (!current) return
        if (action === 'archive') return void archive()
        if (action === 'focusAgent') return focusTerminal(agentId(current.path))
        if (action === 'focusShell') {
          showTab('shell')
          return focusSoon(shellId(current.path))
        }
        if (action === 'showDiff') return showTab('diff')
        if (action === 'sendToAgent') return sendComments(current.path)
        const i = worktrees.indexOf(current)
        const n = worktrees.length
        if (action === 'prev') return setSelected(worktrees[(i - 1 + n) % n].path)
        if (action === 'next') return setSelected(worktrees[(i + 1) % n].path)
        const target = worktrees[Number(action.split(':')[1]) - 1]
        if (target) setSelected(target.path)
      }),
    [worktrees, current, currentRepo, addRepo, archive, sendComments]
  )

  const onStatus = useCallback(
    (path: string, status: AgentStatus) => setStatuses((s) => ({ ...s, [path]: status })),
    []
  )
  const onComments = useCallback(
    (path: string, list: ReviewComment[]) => setComments((c) => ({ ...c, [path]: list })),
    []
  )

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="brand">Troy</span>
          <button className="icon-button" onClick={addRepo} title={`Add repository (${MOD}O)`}>
            +
          </button>
        </div>
        <nav className="repo-list">
          {repos.map((repo) => (
            <section key={repo.path} className="repo">
              <div className="repo-header" title={repo.path}>
                <span className="repo-name">{basename(repo.path)}</span>
                <button
                  className="icon-button"
                  onClick={() => setDialogRepo(repo.path)}
                  title={`New worktree (${MOD}N)`}
                >
                  +
                </button>
              </div>
              {repo.error && <p className="error">{repo.error}</p>}
              {repo.worktrees.map((wt) => {
                const i = worktrees.indexOf(wt)
                const status = statuses[wt.path] ?? 'idle'
                const usage = contexts[wt.path]
                return (
                  <button
                    key={wt.path}
                    className={`worktree ${wt === current ? 'selected' : ''}`}
                    onClick={() => setSelected(wt.path)}
                    title={wt.path}
                  >
                    <span className={`dot ${status}`} title={status} />
                    <span className="branch">{wt.branch ?? 'detached'}</span>
                    <span className="agent">{wt.agent}</span>
                    {i < 9 && <kbd>{`${MOD}${i + 1}`}</kbd>}
                    {usage && (
                      <span
                        className={`ctx-bar ${contextPercent(usage) >= CONTEXT_WARN_PERCENT ? 'warn' : ''}`}
                        title={describeContext(usage)}
                      >
                        <span style={{ width: `${contextPercent(usage)}%` }} />
                      </span>
                    )}
                  </button>
                )
              })}
            </section>
          ))}
        </nav>
        {error && <p className="error">{error}</p>}
      </aside>

      <main className="workspaces">
        {repos.length === 0 ? (
          <div className="empty">
            <h1>Welcome to Troy</h1>
            <p>Add a git repository to get started.</p>
            <button className="primary" onClick={addRepo}>
              Add repository <kbd>{MOD}O</kbd>
            </button>
          </div>
        ) : (
          worktrees
            .filter((wt) => visited.includes(wt.path))
            .map((wt) => (
              <Workspace
                key={wt.path}
                wt={wt}
                active={wt === current}
                showColumn={showColumn}
                tab={tab}
                onTab={setTab}
                firstRun={firstRuns[wt.path]}
                status={statuses[wt.path]}
                context={contexts[wt.path]}
                onStatus={onStatus}
                comments={comments[wt.path] ?? []}
                onComments={onComments}
                onSend={sendComments}
              />
            ))
        )}
      </main>

      {dialogRepo && (
        <NewWorktree
          repoName={basename(dialogRepo)}
          onCancel={() => setDialogRepo(null)}
          onCreate={createWorktree}
        />
      )}
    </div>
  )
}

export default App
