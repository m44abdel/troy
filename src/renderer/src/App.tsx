import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppAction } from '../../shared/keys'
import { isAlive, type AgentStatus } from '../../shared/status'
import type { ContextUsage, Knowledge, Repo, Settings as SettingsData } from '../../shared/types'
import type { VimCommand } from '../../shared/vim'
import { formatComments, type ReviewComment } from './comments'
import { ContextRing } from './ContextRing'
import { NewWorktree, type NewWorktreeRequest } from './NewWorktree'
import { MOD } from './platform'
import { Settings } from './Settings'
import { agentId, focusTerminal, pasteToTerminal, shellId } from './terminals'
import { useVimKeys } from './useVimKeys'
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
  // Keyed by repo: knowledge and its review queue are shared by all of a repo's worktrees.
  const [knowledge, setKnowledge] = useState<Record<string, Knowledge | { error: string }>>({})
  const [dialogRepo, setDialogRepo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<SettingsData>({ vim: false })
  const [showSettings, setShowSettings] = useState(false)
  const [installed, setInstalled] = useState<string[] | null>(null)
  // Set while vim keys move the selection, so focus stays in the sidebar.
  const keepSidebarFocus = useRef(false)

  const worktrees = repos.flatMap((r) => r.worktrees)
  const current = worktrees.find((w) => w.path === selected) ?? worktrees[0]
  const currentRepo = repos.find((r) => current && r.worktrees.includes(current)) ?? repos[0]

  // Terminals mount on first view and then stay alive in the background.
  if (current && !visited.includes(current.path)) setVisited([...visited, current.path])

  useEffect(() => {
    window.api.listRepos().then(setRepos)
    window.api.getSettings().then(setSettings)
    window.api.installedAgents().then(setInstalled)
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

  const knowledgeTarget = current && currentRepo ? `${currentRepo.path}\0${current.path}` : ''
  const refreshKnowledge = useCallback(() => {
    if (!knowledgeTarget) return
    const [repo, path] = knowledgeTarget.split('\0')
    window.api.knowledge(path).then((k) => setKnowledge((all) => ({ ...all, [repo]: k })))
  }, [knowledgeTarget])
  // Agents add proposals from outside the app, so keep checking the queue.
  useEffect(() => {
    refreshKnowledge()
    const timer = setInterval(refreshKnowledge, CONTEXT_POLL_MS)
    return () => clearInterval(timer)
  }, [refreshKnowledge])

  useEffect(() => {
    if (current && !keepSidebarFocus.current) focusTerminal(agentId(current.path))
    keepSidebarFocus.current = false
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

  useVimKeys(settings.vim, (command: VimCommand) => {
    if (!current) return
    if (command === 'open') return focusTerminal(agentId(current.path))
    const i = worktrees.indexOf(current)
    const last = worktrees.length - 1
    const next = { down: Math.min(i + 1, last), up: Math.max(i - 1, 0), top: 0, bottom: last }[
      command as 'down' | 'up' | 'top' | 'bottom'
    ]
    const target = worktrees[next ?? i]
    if (!target || target === current) return
    keepSidebarFocus.current = true
    setSelected(target.path)
    requestAnimationFrame(() => {
      // A key typed before this frame (e.g. Enter) may already have moved focus on.
      if (!document.activeElement?.closest('.sidebar')) return
      document
        .querySelector<HTMLElement>(`.worktree[data-path="${CSS.escape(target.path)}"]`)
        ?.focus()
    })
  })

  const updateSettings = (next: Partial<SettingsData>): void => {
    setSettings((s) => ({ ...s, ...next }))
    window.api.setSettings(next).catch((err) => setError(`Could not save settings: ${err.message}`))
  }

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
        if (action === 'openSettings') return setShowSettings(true)
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
                    data-path={wt.path}
                  >
                    <span className={`dot ${status}`} title={status} />
                    <span className="branch">{wt.branch ?? 'detached'}</span>
                    <span className="agent">{wt.agent}</span>
                    {i < 9 && <kbd>{`${MOD}${i + 1}`}</kbd>}
                    {usage && <ContextRing usage={usage} />}
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
            {installed && (
              <p className="agents-found">
                {installed.length
                  ? `Agents on your PATH: ${installed.join(', ')}.`
                  : 'No agent CLI found on your PATH. Install Claude Code, Codex, Gemini CLI, opencode or aider, or type any command when you create a worktree.'}
              </p>
            )}
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
                onStatus={onStatus}
                comments={comments[wt.path] ?? []}
                onComments={onComments}
                onSend={sendComments}
                knowledge={knowledge[repos.find((r) => r.worktrees.includes(wt))?.path ?? '']}
                onKnowledgeChanged={refreshKnowledge}
              />
            ))
        )}
      </main>

      {dialogRepo && (
        <NewWorktree
          repoName={basename(dialogRepo)}
          installed={installed ?? []}
          onCancel={() => setDialogRepo(null)}
          onCreate={createWorktree}
        />
      )}
      {showSettings && (
        <Settings
          settings={settings}
          installed={installed ?? []}
          onChange={updateSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}

export default App
