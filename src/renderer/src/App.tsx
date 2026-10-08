import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { AppAction } from '../../shared/keys'
import { liveOverlaps, type Overlap } from '../../shared/overlap'
import { isAlive, type AgentStatus } from '../../shared/status'
import type {
  CheckResult,
  ContextUsage,
  Mail,
  Knowledge,
  Repo,
  Settings as SettingsData
} from '../../shared/types'
import type { VimCommand } from '../../shared/vim'
import { formatCheckFailure, formatComments, formatMail, type ReviewComment } from './comments'
import type { DiffFilter } from './DiffPane'
import { NewWorktree, type NewWorktreeRequest } from './NewWorktree'
import { Icon, Logo } from './icons'
import { MOD } from './platform'
import { Settings } from './Settings'
import { STATUS_LABELS } from './statusLabels'
import {
  agentId,
  drawerId,
  focusTerminal,
  pasteToTerminal,
  shellId,
  submitToTerminal
} from './terminals'
import { applyOrder, moveTo } from './order'
import { ReviewList } from './ReviewList'
import { Splitter } from './Splitter'
import { isNumber, isStringList, useStored } from './useStored'
import { useDrawer } from './useDrawer'
import { useVimKeys } from './useVimKeys'
import { Workspace, type ColumnTab, type FirstRun } from './Workspace'
import { ClosedList, WorktreeCard } from './WorktreeCard'

// ponytail: polls session logs; switch to fs.watch in main if this shows up in profiles.
const CONTEXT_POLL_MS = 5000

// How often to look for clashes while two or more agents are working at once.
const OVERLAP_POLL_MS = 10_000

const SIDEBAR = { initial: 272, min: 200, max: 480 }
const AGENT_SHARE = { initial: 55, min: 20, max: 80 }

const clamp = (value: number, { min, max }: { min: number; max: number }): number =>
  Math.min(max, Math.max(min, value))

const omit = <T,>(record: Record<string, T>, key: string): Record<string, T> => {
  const next = { ...record }
  delete next[key]
  return next
}

const basename = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

// Focus after React has shown a pane that may have been hidden.
const focusSoon = (id: string): void => void requestAnimationFrame(() => focusTerminal(id))

function App(): React.JSX.Element {
  const [repos, setRepos] = useState<Repo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [visited, setVisited] = useState<string[]>([])
  // Closed worktrees leave the sidebar (and their terminals stop) until you reopen them.
  const [closed, setClosed] = useStored('troy.closedSessions', [], isStringList)
  const [folded, setFolded] = useStored('troy.foldedRepos', [], isStringList)
  const [sidebarWidth, setSidebarWidth] = useStored('troy.sidebarWidth', SIDEBAR.initial, isNumber)
  // The agent pane's share of the workspace, in percent; the side column gets the rest.
  const [agentShare, setAgentShare] = useStored('troy.agentShare', AGENT_SHARE.initial, isNumber)
  // Worktree paths in the order you arranged them; new worktrees go after.
  const [order, setOrder] = useStored('troy.worktreeOrder', [], isStringList)
  const { open: drawerOpen, setOpen: setDrawerOpen, ...drawer } = useDrawer()
  // Repos whose closed worktrees are listed for reopening.
  const [showClosed, setShowClosed] = useState<string[]>([])
  const [statuses, setStatuses] = useState<Record<string, AgentStatus>>({})
  // Worktrees whose current wait you have already seen; a new status clears the mark.
  const [seen, setSeen] = useState<Record<string, boolean>>({})
  const [firstRuns, setFirstRuns] = useState<Record<string, FirstRun>>({})
  const [showColumn, setShowColumn] = useState(true)
  const [tab, setTab] = useState<ColumnTab>('shell')
  const [checks, setChecks] = useState<Record<string, CheckResult>>({})
  // An overlap line narrows that worktree's diff to its files until "Show all".
  const [diffFilters, setDiffFilters] = useState<Record<string, DiffFilter>>({})
  const [overlaps, setOverlaps] = useState<Record<string, Overlap[]>>({})
  const [contexts, setContexts] = useState<Record<string, ContextUsage | null>>({})
  const [comments, setComments] = useState<Record<string, ReviewComment[]>>({})
  // Keyed by repo: knowledge and its review queue are shared by all of a repo's worktrees.
  const [knowledge, setKnowledge] = useState<Record<string, Knowledge | { error: string }>>({})
  const [dialogRepo, setDialogRepo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<SettingsData>({ vim: false })
  const [showSettings, setShowSettings] = useState(false)
  const [installed, setInstalled] = useState<string[] | null>(null)
  const currentPath = useRef<string | undefined>(undefined)
  // Set while vim keys move the selection, so focus stays in the sidebar.
  const keepSidebarFocus = useRef(false)

  const sorted = useMemo(
    () => repos.map((r) => ({ ...r, worktrees: applyOrder(r.worktrees, order, (w) => w.path) })),
    [repos, order]
  )
  const worktrees = sorted.flatMap((r) => r.worktrees).filter((w) => !closed.includes(w.path))
  const current = worktrees.find((w) => w.path === selected) ?? worktrees[0]
  const currentRepo = repos.find((r) => current && r.worktrees.includes(current)) ?? repos[0]

  const reposRef = useRef(repos)
  const statusesRef = useRef(statuses)
  useEffect(() => {
    currentPath.current = current?.path
    reposRef.current = repos
    statusesRef.current = statuses
  })

  // Messages from other agents, held per receiving worktree until its agent is running.
  const inbox = useRef<Record<string, Mail[]>>({})
  const [queuedMail, setQueuedMail] = useState<Record<string, number>>({})
  const deliverMail = useCallback((path: string) => {
    const waiting = inbox.current[path] ?? []
    const kept = waiting.filter(
      (m) => !submitToTerminal(agentId(path), formatMail(m.fromBranch ?? basename(m.from), m.text))
    )
    inbox.current = { ...inbox.current, [path]: kept }
    setQueuedMail((q) => (kept.length ? { ...q, [path]: kept.length } : omit(q, path)))
  }, [])

  useEffect(() => {
    const off = window.api.onMail((mail) => {
      inbox.current = { ...inbox.current, [mail.to]: [...(inbox.current[mail.to] ?? []), mail] }
      if (isAlive(statusesRef.current[mail.to])) deliverMail(mail.to)
      else setQueuedMail((q) => ({ ...q, [mail.to]: (q[mail.to] ?? 0) + 1 }))
    })
    void window.api.watchMail()
    return off
  }, [deliverMail])

  // Opening a worktree acknowledges whatever it is waiting on, reopens a closed session
  // and unfolds its repo.
  const select = useCallback(
    (path: string) => {
      setSelected(path)
      setSeen((s) => ({ ...s, [path]: true }))
      setClosed((c) => c.filter((p) => p !== path))
      const repo = reposRef.current.find((r) => r.worktrees.some((w) => w.path === path))
      if (repo) setFolded((f) => f.filter((r) => r !== repo.path))
    },
    [setClosed, setFolded]
  )

  // Terminals mount on first view and then stay alive in the background, until closed.
  if (current && !visited.includes(current.path) && !closed.includes(current.path))
    setVisited([...visited, current.path])

  // Reorders within a repo; a drop from another repo is ignored.
  const move = useCallback(
    (from: string, to: string): void => {
      const repo = repos.find((r) => r.worktrees.some((w) => w.path === from))
      const paths = applyOrder(repo?.worktrees ?? [], order, (w) => w.path).map((w) => w.path)
      if (!paths.includes(to)) return
      const moved = moveTo(paths, from, to)
      setOrder((o) => [...moved, ...o.filter((p) => !moved.includes(p))])
    },
    [repos, order, setOrder]
  )

  const toggle = (list: string[], item: string): string[] =>
    list.includes(item) ? list.filter((i) => i !== item) : [...list, item]

  useEffect(() => {
    window.api.listRepos().then(setRepos)
    window.api.getSettings().then(setSettings)
    window.api.installedAgents().then(setInstalled)
  }, [])

  // Card and diff show the latest result; a worktree with no .troy/check has none.
  const runCheck = useCallback(async (path: string): Promise<CheckResult | null> => {
    const { result = null, error } = await window.api.runCheck(path)
    if (error) console.warn(`Could not run .troy/check in ${path}`, error)
    setChecks((all) => (result ? { ...all, [path]: result } : omit(all, path)))
    return result
  }, [])

  // Recomputed when worktrees come or go, whenever an agent's status changes, and every few
  // seconds while two or more agents work at once (they clash while editing, not after).
  const refreshOverlaps = useCallback(() => void window.api.overlaps().then(setOverlaps), [])
  useEffect(refreshOverlaps, [repos, refreshOverlaps])
  const concurrent = worktrees.filter((wt) => isAlive(statuses[wt.path])).length >= 2
  useEffect(() => {
    if (!concurrent) return
    const timer = setInterval(refreshOverlaps, OVERLAP_POLL_MS)
    return () => clearInterval(timer)
  }, [concurrent, refreshOverlaps])
  // Only sessions live at the same time can trip over each other.
  const clashes = useMemo(
    () => liveOverlaps(overlaps, (path) => isAlive(statuses[path])),
    [overlaps, statuses]
  )

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
    if (added?.worktrees[0]) select(added.worktrees[0].path)
  }, [select])

  const createWorktree = async (req: NewWorktreeRequest): Promise<string | null> => {
    if (!dialogRepo) return null
    const result = await window.api.createWorktree(dialogRepo, req)
    setRepos(result.repos)
    if (result.error || !result.path) return result.error ?? 'Could not create the worktree.'
    const path = result.path
    setFirstRuns((f) => ({ ...f, [path]: { prompt: req.prompt, setup: !!result.setup } }))
    setDialogRepo(null)
    // Created, but not from the latest base (offline, or a local base that couldn't move).
    setError(result.warning ?? null)
    select(path)
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

  // Stops the agent and shell (unmounting kills their processes); the worktree stays.
  const closeSession = useCallback(
    (path: string) => {
      const working = statuses[path] === 'running'
      if (working && !window.confirm('The agent is still working. Close its session anyway?'))
        return
      setVisited((v) => v.filter((p) => p !== path))
      setClosed((c) => [...c, path])
      setStatuses((s) => omit(s, path))
      setFirstRuns((f) => omit(f, path))
    },
    [statuses, setClosed]
  )

  const sendCheck = useCallback(
    (path: string) => {
      const check = checks[path]
      if (!check || check.ok || !isAlive(statuses[path])) return
      pasteToTerminal(agentId(path), formatCheckFailure(check.output))
      focusTerminal(agentId(path))
    },
    [checks, statuses]
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
    select(target.path)
    requestAnimationFrame(() => {
      // A key typed before this frame (e.g. Enter) may already have moved focus on.
      if (!document.activeElement?.closest('.sidebar')) return
      document
        .querySelector<HTMLElement>(
          `.worktree[data-path="${CSS.escape(target.path)}"] .card-select`
        )
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

  // Opening the drawer shows the column it sits in and puts the cursor in it.
  const toggleDrawer = useCallback(
    (path: string): void => {
      if (drawerOpen) return setDrawerOpen(false)
      setDrawerOpen(true)
      setShowColumn(true)
      focusSoon(drawerId(path))
    },
    [drawerOpen, setDrawerOpen]
  )

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
        if (action === 'toggleTerminal') return toggleDrawer(current.path)
        if (action === 'sendToAgent') return sendComments(current.path)
        const i = worktrees.indexOf(current)
        const n = worktrees.length
        if (action === 'prev') return select(worktrees[(i - 1 + n) % n].path)
        if (action === 'next') return select(worktrees[(i + 1) % n].path)
        if (action === 'moveUp' || action === 'moveDown') {
          const siblings = worktrees.filter((w) => currentRepo?.worktrees.includes(w))
          const target = siblings[siblings.indexOf(current) + (action === 'moveUp' ? -1 : 1)]
          return target && move(current.path, target.path)
        }
        const target = worktrees[Number(action.split(':')[1]) - 1]
        if (target) select(target.path)
      }),
    [worktrees, current, currentRepo, addRepo, archive, sendComments, select, move, toggleDrawer]
  )

  // A status change on the open worktree while Troy has focus happens in front of you.
  // Anything else you hear about, but only when the status is reported, not guessed.
  const onStatus = useCallback(
    (path: string, status: AgentStatus, certain: boolean) => {
      setStatuses((s) => ({ ...s, [path]: status }))
      const watching = path === currentPath.current && document.hasFocus()
      setSeen((s) => ({ ...s, [path]: watching }))
      if (isAlive(status)) deliverMail(path)
      refreshOverlaps()
      // Only a reported stop: a guessed pause may be the agent mid-edit.
      if (certain && status !== 'running') void runCheck(path)
      if (watching || !certain || status === 'running') return
      const note = new Notification(basename(path), { body: `Agent ${STATUS_LABELS[status]}` })
      note.onclick = () => select(path)
    },
    [select, refreshOverlaps, runCheck, deliverMail]
  )

  // Coming back to Troy acknowledges the worktree that is open.
  useEffect(() => {
    const onFocus = (): void => {
      const path = currentPath.current
      if (path) setSeen((s) => ({ ...s, [path]: true }))
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const nameOf = (path: string): string => {
    const wt = worktrees.find((w) => w.path === path)
    return wt?.title ?? wt?.branch ?? basename(path)
  }

  // One notification per new clash, when you're not already looking at Troy.
  const notified = useRef(new Set<string>())
  const notifyClash = useEffectEvent((path: string, overlap: Overlap) => {
    const key = [path, overlap.other, ...overlap.files].join('\0')
    if (notified.current.has(key)) return
    notified.current.add(key)
    if (document.hasFocus()) return
    const note = new Notification('Two agents are editing the same files', {
      body: `${nameOf(path)} and ${nameOf(overlap.other)}: ${overlap.files.join(', ')}`
    })
    note.onclick = () => select(path)
  })
  useEffect(() => {
    for (const [path, list] of Object.entries(clashes))
      for (const o of list) if (o.kind === 'same' && path < o.other) notifyClash(path, o)
  }, [clashes])

  const needsYou = (path: string): boolean => statuses[path] === 'waiting' && !seen[path]
  const waiting = worktrees.filter((wt) => needsYou(wt.path))

  useEffect(() => window.api.setBadge(waiting.length), [waiting.length])
  const clearWaiting = (): void =>
    setSeen((s) => ({ ...s, ...Object.fromEntries(waiting.map((wt) => [wt.path, true])) }))
  const onComments = useCallback(
    (path: string, list: ReviewComment[]) => setComments((c) => ({ ...c, [path]: list })),
    []
  )

  return (
    <div
      className="app"
      style={
        {
          '--sidebar-width': `${clamp(sidebarWidth, SIDEBAR)}px`,
          '--agent-share': clamp(agentShare, AGENT_SHARE)
        } as React.CSSProperties
      }
    >
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="brand">
            <Logo size={22} />
            Troy
          </span>
          <button
            className="icon-button"
            onClick={addRepo}
            title={`Add repository (${MOD}O)`}
            aria-label="Add repository"
          >
            <Icon name="folderPlus" />
          </button>
        </div>
        <nav className="repo-list">
          {sorted.map((repo) => (
            <section key={repo.path} className="repo">
              <div className="repo-header" title={repo.path}>
                <button
                  className="repo-toggle"
                  onClick={() => setFolded((f) => toggle(f, repo.path))}
                  aria-expanded={!folded.includes(repo.path)}
                >
                  <Icon name="chevron" size={13} />
                  <Icon name="folder" size={13} />
                  <span className="repo-name">{basename(repo.path)}</span>
                </button>
                {/* Folded, the header still says when an agent inside needs you. */}
                {folded.includes(repo.path) && repo.worktrees.some((wt) => needsYou(wt.path)) && (
                  <span className="count waiting">
                    {repo.worktrees.filter((wt) => needsYou(wt.path)).length} waiting
                  </span>
                )}
                <span className="count">{repo.worktrees.length}</span>
                <button
                  className="icon-button"
                  onClick={() => setDialogRepo(repo.path)}
                  title={`New worktree (${MOD}N)`}
                  aria-label={`New worktree in ${basename(repo.path)}`}
                >
                  <Icon name="plus" size={14} />
                </button>
              </div>
              {repo.error && <p className="error">{repo.error}</p>}
              {!folded.includes(repo.path) &&
                repo.worktrees
                  .filter((wt) => !closed.includes(wt.path))
                  .map((wt) => (
                    <WorktreeCard
                      key={wt.path}
                      wt={wt}
                      index={worktrees.indexOf(wt)}
                      selected={wt === current}
                      status={statuses[wt.path] ?? 'idle'}
                      needsYou={needsYou(wt.path)}
                      overlaps={clashes[wt.path]?.map((o) => ({
                        name: nameOf(o.other),
                        kind: o.kind,
                        files: o.files
                      }))}
                      usage={contexts[wt.path]}
                      check={checks[wt.path]}
                      mail={queuedMail[wt.path]}
                      onSelect={() => select(wt.path)}
                      onClose={() => closeSession(wt.path)}
                      onMoveHere={(from) => move(from, wt.path)}
                      onOverlap={(files, label) => {
                        setDiffFilters((f) => ({ ...f, [wt.path]: { files, label } }))
                        select(wt.path)
                        showTab('diff')
                      }}
                    />
                  ))}
              <ClosedList
                worktrees={repo.worktrees.filter((wt) => closed.includes(wt.path))}
                open={showClosed.includes(repo.path) && !folded.includes(repo.path)}
                onToggle={() => setShowClosed((r) => toggle(r, repo.path))}
                onReopen={select}
              />
            </section>
          ))}
          <ReviewList />
        </nav>
        {waiting.length > 0 && (
          <button className="link clear-waiting" onClick={clearWaiting}>
            Clear all waiting
          </button>
        )}
        {error && <p className="error">{error}</p>}
        <footer className="sidebar-footer">
          <button className="footer-button" onClick={() => setShowSettings(true)}>
            <Icon name="settings" size={15} />
            Settings
            <kbd>{MOD},</kbd>
          </button>
        </footer>
      </aside>
      <Splitter
        label="Resize sidebar"
        value={sidebarWidth}
        min={SIDEBAR.min}
        max={SIDEBAR.max}
        // The sidebar starts at the window's left edge, so the pointer's x is its width.
        onMove={(x) => setSidebarWidth(clamp(x, SIDEBAR))}
        onReset={() => setSidebarWidth(SIDEBAR.initial)}
      />

      <main className="workspaces">
        {repos.length === 0 ? (
          <div className="empty">
            <div className="hero-logo">
              <Logo size={72} />
            </div>
            <h1>Welcome to Troy</h1>
            <p className="tagline">Run coding agents side by side, each in its own git worktree.</p>
            <ul className="features">
              <li>
                <Icon name="branch" size={18} />
                <strong>One worktree per task</strong>
                <span>Branch, ports and setup handled for you.</span>
              </li>
              <li>
                <Icon name="diff" size={18} />
                <strong>Review and ship</strong>
                <span>Comment on the diff, commit, push, open a PR.</span>
              </li>
              <li>
                <Icon name="sparkles" size={18} />
                <strong>Shared knowledge</strong>
                <span>Facts your agents learn, reviewed by you.</span>
              </li>
            </ul>
            <button className="primary large" onClick={addRepo}>
              <Icon name="folderPlus" />
              Add repository <kbd>{MOD}O</kbd>
            </button>
            {installed && (
              <p className="agents-found">
                {installed.length ? (
                  <>
                    Agents on your PATH:{' '}
                    {installed.map((a) => (
                      <span key={a} className="chip">
                        {a}
                      </span>
                    ))}
                  </>
                ) : (
                  'No agent CLI found on your PATH. Install Claude Code, Codex, Gemini CLI, opencode or aider, or type any command when you create a worktree.'
                )}
              </p>
            )}
          </div>
        ) : (
          <>
            {worktrees
              .filter((wt) => visited.includes(wt.path))
              .map((wt) => (
                <Workspace
                  key={wt.path}
                  wt={wt}
                  active={wt === current}
                  showColumn={showColumn}
                  tab={tab}
                  onTab={setTab}
                  onToggleColumn={() => setShowColumn((v) => !v)}
                  firstRun={firstRuns[wt.path]}
                  status={statuses[wt.path]}
                  onStatus={onStatus}
                  comments={comments[wt.path] ?? []}
                  onComments={onComments}
                  onSend={sendComments}
                  check={checks[wt.path]}
                  onRunCheck={runCheck}
                  onSendCheck={sendCheck}
                  agentShare={clamp(agentShare, AGENT_SHARE)}
                  onAgentShare={(share) => setAgentShare(clamp(share, AGENT_SHARE))}
                  onResetAgentShare={() => setAgentShare(AGENT_SHARE.initial)}
                  diffFilter={diffFilters[wt.path]}
                  onClearDiffFilter={() => setDiffFilters((f) => omit(f, wt.path))}
                  knowledge={knowledge[repos.find((r) => r.worktrees.includes(wt))?.path ?? '']}
                  onKnowledgeChanged={refreshKnowledge}
                  drawerOpen={drawerOpen}
                  onToggleDrawer={() => toggleDrawer(wt.path)}
                  drawerHeight={drawer.height}
                  onDrawerHeight={drawer.setHeight}
                />
              ))}
          </>
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
