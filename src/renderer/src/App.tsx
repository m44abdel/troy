import { useCallback, useEffect, useState } from 'react'
import type { AppAction } from '../../shared/keys'
import type { AgentStatus } from '../../shared/status'
import type { Repo, WorktreeView } from '../../shared/types'
import { NewWorktree, type NewWorktreeRequest } from './NewWorktree'
import { Terminal } from './Terminal'
import { focusTerminal } from './terminals'

const isMac = navigator.userAgent.includes('Mac')
const MOD = isMac ? '⌘' : 'Ctrl+Shift+'
const SETUP_COMMAND = 'sh .troy/setup.sh\r'

const basename = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path
const agentId = (path: string): string => `${path}:agent`
const shellId = (path: string): string => `${path}:shell`

/** What a worktree created this session still needs on its first launch. */
interface FirstRun {
  prompt: string
  setup: boolean
}

interface WorkspaceProps {
  wt: WorktreeView
  active: boolean
  showShell: boolean
  firstRun?: FirstRun
  onStatus: (path: string, status: AgentStatus) => void
}

function Workspace({
  wt,
  active,
  showShell,
  firstRun,
  onStatus
}: WorkspaceProps): React.JSX.Element {
  return (
    <div className="workspace" style={{ display: active ? 'flex' : 'none' }}>
      <div className="pane pane-agent">
        <Terminal
          id={agentId(wt.path)}
          cwd={wt.path}
          port={wt.port}
          command={wt.agent}
          prompt={firstRun?.prompt || undefined}
          onStatus={(status) => onStatus(wt.path, status)}
        />
      </div>
      <div className="pane pane-shell" style={{ display: showShell ? 'block' : 'none' }}>
        <Terminal
          id={shellId(wt.path)}
          cwd={wt.path}
          port={wt.port}
          initialInput={firstRun?.setup ? SETUP_COMMAND : undefined}
        />
      </div>
    </div>
  )
}

function App(): React.JSX.Element {
  const [repos, setRepos] = useState<Repo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [visited, setVisited] = useState<string[]>([])
  const [statuses, setStatuses] = useState<Record<string, AgentStatus>>({})
  const [firstRuns, setFirstRuns] = useState<Record<string, FirstRun>>({})
  const [showShell, setShowShell] = useState(true)
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

  useEffect(
    () =>
      window.api.onAction((action: AppAction) => {
        if (action === 'addRepo') return void addRepo()
        if (action === 'newWorktree') return currentRepo && setDialogRepo(currentRepo.path)
        if (action === 'toggleShell') return setShowShell((s) => !s)
        if (!current) return
        if (action === 'archive') return void archive()
        if (action === 'focusAgent') return focusTerminal(agentId(current.path))
        if (action === 'focusShell') {
          setShowShell(true)
          return focusTerminal(shellId(current.path))
        }
        const i = worktrees.indexOf(current)
        const n = worktrees.length
        if (action === 'prev') return setSelected(worktrees[(i - 1 + n) % n].path)
        if (action === 'next') return setSelected(worktrees[(i + 1) % n].path)
        const target = worktrees[Number(action.split(':')[1]) - 1]
        if (target) setSelected(target.path)
      }),
    [worktrees, current, currentRepo, addRepo, archive]
  )

  const onStatus = useCallback(
    (path: string, status: AgentStatus) => setStatuses((s) => ({ ...s, [path]: status })),
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
                showShell={showShell}
                firstRun={firstRuns[wt.path]}
                onStatus={onStatus}
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
