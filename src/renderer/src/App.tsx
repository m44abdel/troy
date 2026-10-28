import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { AppAction } from '../../shared/keys'
import { liveOverlaps, type Overlap } from '../../shared/overlap'
import { isAlive, type AgentStatus } from '../../shared/status'
import type {
  BranchPr,
  CheckResult,
  ContextUsage,
  Issue,
  Mail,
  SpawnRequest,
  Knowledge,
  Repo,
  SessionSummary,
  Settings as SettingsData,
  WorktreeView
} from '../../shared/types'
import type { VimCommand } from '../../shared/vim'
import { formatCheckFailure, formatComments, formatMail, type ReviewComment } from './comments'
import type { DiffFilter } from './DiffPane'
import { NewWorktree, type NewWorktreeRequest } from './NewWorktree'
import { clamp } from './clamp'
import { Icon } from './icons'
import { MOD } from './platform'
import { Settings } from './Settings'
import { STATUS_LABELS } from './statusLabels'
import {
  agentId,
  focusTerminal,
  focusWorktree,
  pasteToTerminal,
  submitToTerminal
} from './terminals'
import { applyOrder, moveTo } from './order'
import { Splitter } from './Splitter'
import { isNumber, isStringList, useStored } from './useStored'

const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean'
import { useVimKeys } from './useVimKeys'
import { Workspace, type ColumnTab, type FirstRun } from './Workspace'
import { WorktreeCard } from './WorktreeCard'
import { SearchPalette } from './SearchPalette'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { issueBranch, issuePrompt } from './tasks'
import { TasksPage } from './TasksPage'
import { Board } from './Board'
import { Automations } from './Automations'

// Polls the session logs. Move to fs.watch in main if it shows up in a profile.
const CONTEXT_POLL_MS = 5000

const OVERLAP_POLL_MS = 10_000
const PR_ICON_POLL_MS = 2 * 60_000
const SESSION_POLL_MS = 30_000

const SIDEBAR = { initial: 272, min: 200, max: 480 }
const AGENT_SHARE = { initial: 55, min: 20, max: 80 }

const omit = <T,>(record: Record<string, T>, key: string): Record<string, T> => {
  const next = { ...record }
  delete next[key]
  return next
}

const basename = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

function App(): React.JSX.Element {
  const [repos, setRepos] = useState<Repo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [visited, setVisited] = useState<string[]>([])
  const [closed, setClosed] = useStored('troy.closedSessions', [], isStringList)
  const [folded, setFolded] = useStored('troy.foldedRepos', [], isStringList)
  const [sidebarWidth, setSidebarWidth] = useStored('troy.sidebarWidth', SIDEBAR.initial, isNumber)
  // Agent pane width, in percent.
  const [agentShare, setAgentShare] = useStored('troy.agentShare', AGENT_SHARE.initial, isNumber)
  const [order, setOrder] = useStored('troy.worktreeOrder', [], isStringList)
  // Repos with their closed list expanded.
  const [showClosed, setShowClosed] = useState<string[]>([])
  const [statuses, setStatuses] = useState<Record<string, AgentStatus>>({})
  // Waits you've already seen; a new status clears the mark.
  const [seen, setSeen] = useState<Record<string, boolean>>({})
  const [firstRuns, setFirstRuns] = useState<Record<string, FirstRun>>({})
  const [showColumn, setShowColumn] = useState(true)
  const [showBoard, setShowBoard] = useState(false)
  const [showAutomations, setShowAutomations] = useState(false)
  const [showTasks, setShowTasks] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [sidebarHidden, setSidebarHidden] = useStored('troy.sidebarHidden', false, isBoolean)
  // Keyed by repo, then branch.
  const [branchPrs, setBranchPrs] = useState<Record<string, Record<string, BranchPr>>>({})
  // The newest conversation that ran in each worktree, keyed by its path.
  const [lastSessions, setLastSessions] = useState<Record<string, SessionSummary>>({})
  const [tab, setTab] = useState<ColumnTab>('git')
  const [filesSearch, setFilesSearch] = useState(0)
  const [checks, setChecks] = useState<Record<string, CheckResult>>({})
  // An overlap line narrows that worktree's diff to its files until "Show all".
  const [diffFilters, setDiffFilters] = useState<Record<string, DiffFilter>>({})
  const [overlaps, setOverlaps] = useState<Record<string, Overlap[]>>({})
  const [contexts, setContexts] = useState<Record<string, ContextUsage | null>>({})
  const [comments, setComments] = useState<Record<string, ReviewComment[]>>({})
  // Keyed by repo: its worktrees share one knowledge file.
  const [knowledge, setKnowledge] = useState<Record<string, Knowledge | { error: string }>>({})
  const [dialogRepo, setDialogRepo] = useState<string | null>(null)
  const [dialogInitial, setDialogInitial] = useState<{ branch: string; prompt: string }>()
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<SettingsData>({ vim: false })
  const [showSettings, setShowSettings] = useState(false)
  const [installed, setInstalled] = useState<string[] | null>(null)
  const currentPath = useRef<string | undefined>(undefined)
  // Vim navigation sets this to keep focus in the sidebar.
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

  // Another agent asked for a worktree; it starts in the background, without taking focus.
  const spawnAgent = useEffectEvent(async (req: SpawnRequest) => {
    const from = reposRef.current.flatMap((r) => r.worktrees).find((w) => w.path === req.from)
    const agent = req.agent ?? from?.agent ?? installed?.[0] ?? ''
    const result = await window.api.createWorktree(req.repo, {
      branch: req.branch,
      base: '',
      agent,
      prompt: req.prompt
    })
    setRepos(result.repos)
    if (result.error || !result.path) {
      const why = result.error ?? 'Could not create the worktree.'
      setError(`Spawning ${req.branch}: ${why}`)
      submitToTerminal(agentId(req.from), `[Troy] Could not spawn ${req.branch}: ${why}`)
      return
    }
    const path = result.path
    setFirstRuns((f) => ({
      ...f,
      [path]: { prompt: req.prompt, setup: !!result.setup, autoStart: true }
    }))
    setVisited((v) => [...v, path])
  })

  useEffect(() => window.api.onSpawn((req) => void spawnAgent(req)), [])

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

  // Recomputed when worktrees come or go, on each status change, and on a timer while two or
  // more agents work.
  const refreshOverlaps = useCallback(() => void window.api.overlaps().then(setOverlaps), [])
  useEffect(refreshOverlaps, [repos, refreshOverlaps])
  const concurrent = worktrees.filter((wt) => isAlive(statuses[wt.path])).length >= 2
  useEffect(() => {
    if (!concurrent) return
    const timer = setInterval(refreshOverlaps, OVERLAP_POLL_MS)
    return () => clearInterval(timer)
  }, [concurrent, refreshOverlaps])
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
  // Agents add proposals from outside the app.
  useEffect(() => {
    refreshKnowledge()
    const timer = setInterval(refreshKnowledge, CONTEXT_POLL_MS)
    return () => clearInterval(timer)
  }, [refreshKnowledge])

  const repoKey = repos.map((r) => r.path).join('\n')
  useEffect(() => {
    const poll = (): void =>
      repoKey
        .split('\n')
        .filter(Boolean)
        .forEach((repo) =>
          window.api.prsByBranch(repo).then(({ prs }) => {
            if (prs) setBranchPrs((all) => ({ ...all, [repo]: prs }))
          })
        )
    poll()
    const timer = setInterval(poll, PR_ICON_POLL_MS)
    window.addEventListener('focus', poll)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', poll)
    }
  }, [repoKey])

  useEffect(() => {
    const poll = (): void =>
      void window.api.sessions().then((found) => {
        if ('error' in found) return
        // Newest first, so the first one per folder is its latest.
        const latest: Record<string, SessionSummary> = {}
        for (const s of found.sessions) latest[s.cwd] ??= s
        setLastSessions(latest)
      })
    poll()
    const timer = setInterval(poll, SESSION_POLL_MS)
    window.addEventListener('focus', poll)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', poll)
    }
  }, [])

  const openDialog = (repo: string, initial?: { branch: string; prompt: string }): void => {
    setDialogRepo(repo)
    setDialogInitial(initial)
  }
  const startIssue = (repo: string, issue: Issue): void => {
    setShowTasks(false)
    openDialog(repo, { branch: issueBranch(issue), prompt: issuePrompt(issue) })
  }

  useEffect(() => {
    if (current && !keepSidebarFocus.current) focusWorktree(current.path)
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
    if (command === 'open') return focusWorktree(current.path)
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

  useEffect(
    () =>
      window.api.onAction((action: AppAction) => {
        if (action === 'addRepo') return void addRepo()
        if (action === 'newWorktree') return currentRepo && openDialog(currentRepo.path)
        if (action === 'search') return setShowSearch(true)
        if (action === 'toggleSidebar') return setSidebarHidden((h) => !h)
        if (action === 'toggleColumn') return setShowColumn((s) => !s)
        if (action === 'toggleBoard') {
          setShowTasks(false)
          return setShowBoard((s) => !s)
        }
        if (action === 'openSettings') return setShowSettings(true)
        if (!current) return
        if (action === 'archive') return void archive()
        if (action === 'showSourceControl') return showTab('git')
        if (action === 'showFiles') return showTab('files')
        if (action === 'findInFiles') {
          showTab('files')
          return setFilesSearch((n) => n + 1)
        }
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
        if (!action.startsWith('jump:')) return
        const target = worktrees[Number(action.split(':')[1]) - 1]
        if (target) select(target.path)
      }),
    [
      worktrees,
      current,
      currentRepo,
      addRepo,
      archive,
      sendComments,
      select,
      move,
      setSidebarHidden
    ]
  )

  // Notifies unless the worktree is open with Troy focused, and only for reported statuses.
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

  const repoOf = (path: string): string | undefined =>
    repos.find((r) => r.worktrees.some((w) => w.path === path))?.path

  const cardFor = (wt: WorktreeView): React.JSX.Element => (
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
      pr={wt.branch ? branchPrs[repoOf(wt.path) ?? '']?.[wt.branch] : undefined}
      session={lastSessions[wt.path]}
      onSelect={() => {
        select(wt.path)
        setShowBoard(false)
        setShowTasks(false)
      }}
      onClose={() => closeSession(wt.path)}
      onMoveHere={(from) => move(from, wt.path)}
      onOverlap={(files, label) => {
        setDiffFilters((f) => ({ ...f, [wt.path]: { files, label } }))
        select(wt.path)
        showTab('git')
      }}
    />
  )

  return (
    <div
      className={sidebarHidden ? 'app sidebar-hidden' : 'app'}
      style={
        {
          '--sidebar-width': `${clamp(sidebarWidth, SIDEBAR)}px`,
          '--agent-share': clamp(agentShare, AGENT_SHARE)
        } as React.CSSProperties
      }
    >
      <div className="app-body">
        {!sidebarHidden && (
          <Sidebar
            repos={sorted}
            closed={closed}
            folded={folded}
            onToggleFold={(repo) => setFolded((f) => toggle(f, repo))}
            showClosed={showClosed}
            onToggleClosed={(repo) => setShowClosed((r) => toggle(r, repo))}
            onReopen={select}
            needsYou={needsYou}
            waiting={waiting.length}
            onClearWaiting={clearWaiting}
            error={error}
            card={cardFor}
            showBoard={showBoard}
            showTasks={showTasks}
            onSearch={() => setShowSearch(true)}
            onTasks={() => {
              setShowBoard(false)
              setShowTasks((t) => !t)
            }}
            onAutomations={() => setShowAutomations(true)}
            onBoard={() => {
              setShowTasks(false)
              setShowBoard((b) => !b)
            }}
            onAddRepo={addRepo}
            onNewWorktree={(repo) => openDialog(repo)}
            onSettings={() => setShowSettings(true)}
            onHide={() => setSidebarHidden(true)}
          />
        )}
        {!sidebarHidden && (
          <Splitter
            label="Resize sidebar"
            value={sidebarWidth}
            min={SIDEBAR.min}
            max={SIDEBAR.max}
            // The sidebar starts at the window's left edge, so the pointer's x is its width.
            onMove={(x) => setSidebarWidth(clamp(x, SIDEBAR))}
            onReset={() => setSidebarWidth(SIDEBAR.initial)}
          />
        )}

        <main className="workspaces">
          {repos.length === 0 ? (
            <div className="empty">
              <p>Add a git repository to start.</p>
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
                    onCloseSession={() => closeSession(wt.path)}
                    filesSearch={filesSearch}
                    repos={repos}
                    onOpenWorktree={select}
                  />
                ))}
            </>
          )}
          {/* After the workspaces: a later element wins over the tab strip's window-drag area. */}
          {sidebarHidden && (
            <button
              className="icon-button show-sidebar"
              onClick={() => setSidebarHidden(false)}
              title={`Show sidebar (${MOD}B)`}
              aria-label="Show sidebar"
            >
              <Icon name="sidebar" />
            </button>
          )}
          {showBoard && (
            <Board items={worktrees} status={(wt) => statuses[wt.path] ?? 'idle'} card={cardFor} />
          )}
          {showTasks && (
            <TasksPage
              repos={repos.map((r) => r.path)}
              onStart={startIssue}
              onClose={() => setShowTasks(false)}
            />
          )}
        </main>
      </div>
      <StatusBar working={worktrees.some((wt) => statuses[wt.path] === 'running')} />

      {dialogRepo && (
        <NewWorktree
          repoName={basename(dialogRepo)}
          installed={installed ?? []}
          onCancel={() => setDialogRepo(null)}
          onCreate={createWorktree}
          initial={dialogInitial}
        />
      )}
      {showSearch && (
        <SearchPalette
          repos={sorted}
          onPick={(path) => {
            setShowBoard(false)
            setShowTasks(false)
            select(path)
          }}
          onClose={() => setShowSearch(false)}
        />
      )}
      {showAutomations && (
        <Automations
          repos={repos.map((r) => r.path)}
          installed={installed ?? []}
          onClose={() => setShowAutomations(false)}
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
