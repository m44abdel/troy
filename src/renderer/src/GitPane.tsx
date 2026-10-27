import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileData } from 'react-diff-view'
import type { CheckResult, Commit, PrStatus } from '../../shared/types'
import type { ReviewComment } from './comments'
import { DiffView, type DiffFilter } from './DiffPane'
import { countChanges, fileName, parseFiles } from './diff'
import { Icon } from './icons'
import { MOD } from './platform'

interface Props {
  path: string
  branch: string
  /** Whether the agent can write a commit message (Claude Code only, so far). */
  canSuggest: boolean
  visible: boolean
  /** Changes whenever the diff may be stale, e.g. the agent's status moved. */
  refreshKey: string
  pr?: PrStatus | null
  comments: ReviewComment[]
  onComments: (comments: ReviewComment[]) => void
  canSend: boolean
  onSend: () => void
  /** The latest `.troy/check` result, if the repo has one. */
  check?: CheckResult
  onRunCheck: () => Promise<CheckResult | null>
  onSendCheck: () => void
  filter?: DiffFilter
  onClearFilter: () => void
}

type Result = { error?: string }

const BADGES: Record<FileData['type'], string> = {
  add: 'A',
  delete: 'D',
  modify: 'M',
  rename: 'R',
  copy: 'C'
}

const sum = (files: FileData[], type: 'insert' | 'delete'): number =>
  files.reduce((n, f) => n + countChanges(f, type), 0)

/** Source Control: what the branch changed, a commit box, its commits and the diff to comment on. */
export function GitPane({
  path,
  branch,
  canSuggest,
  visible,
  refreshKey,
  pr,
  comments,
  onComments,
  canSend,
  onSend,
  check,
  onRunCheck,
  onSendCheck,
  filter,
  onClearFilter
}: Props): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const [files, setFiles] = useState<FileData[] | null>(null)
  const [commits, setCommits] = useState<Commit[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [message, setMessage] = useState('')

  const fetchAll = useCallback(
    () => Promise.all([window.api.diff(path), window.api.log(path)]),
    [path]
  )
  const apply = useCallback(([diff, log]: Awaited<ReturnType<typeof fetchAll>>) => {
    if (diff.error) setError(diff.error)
    else setFiles(parseFiles(diff.diff ?? ''))
    setCommits(log.commits ?? [])
  }, [])
  const load = (): Promise<void> => fetchAll().then(apply)

  useEffect(() => {
    if (!visible) return
    let current = true
    fetchAll().then((r) => current && apply(r))
    return () => {
      current = false
    }
  }, [visible, refreshKey, fetchAll, apply])

  const shown = filter ? files?.filter((f) => filter.files.includes(fileName(f))) : files

  const act = async (run: () => Promise<Result>, done: string): Promise<boolean> => {
    setBusy(true)
    setNotice(null)
    const result = await run()
    setBusy(false)
    setError(result.error ?? null)
    if (!result.error) setNotice(done)
    void load()
    return !result.error
  }

  // Shipping runs the check first (instant when nothing changed) and asks before shipping a failure.
  const ship = async (run: () => Promise<Result>, done: string): Promise<void> => {
    setBusy(true)
    setNotice('Running .troy/check…')
    const result = await onRunCheck()
    setBusy(false)
    setNotice(null)
    if (result && !result.ok && !window.confirm('.troy/check is failing. Ship anyway?')) return
    await act(run, done)
  }

  // These buttons sit in the <summary>; without preventDefault a click also folds the output.
  const recheck = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    await onRunCheck()
    setBusy(false)
  }

  const commit = async (): Promise<boolean> => {
    const ok = await act(() => window.api.commit(path, message), 'Committed.')
    if (ok) setMessage('')
    return ok
  }

  const suggest = async (): Promise<void> => {
    setSuggesting(true)
    setError(null)
    const result = await window.api.suggestMessage(path)
    setSuggesting(false)
    if (result.error) setError(result.error)
    else setMessage(result.message ?? '')
  }

  const push = (): Promise<void> => ship(() => window.api.push(path), 'Pushed.')
  const openPr = (): Promise<void> =>
    ship(() => window.api.openPullRequest(path), 'Opened the pull request in your browser.')
  const menu: Array<[string, () => Promise<void>]> = [
    [
      'Commit & push',
      async () => {
        if (await commit()) await push()
      }
    ],
    ['Push', push],
    ['Open PR', openPr]
  ]

  const scrollTo = (name: string): void =>
    root.current
      ?.querySelector(`[data-file="${CSS.escape(name)}"]`)
      ?.scrollIntoView({ block: 'start' })

  return (
    <div className="diff-pane git-pane" ref={root}>
      <header className="git-head">
        <span className="git-branch">
          <Icon name="branch" size={13} />
          <span>{branch}</span>
          {pr && (
            <a className="link" href={pr.url} target="_blank" rel="noreferrer">
              #{pr.number}
            </a>
          )}
        </span>
        {shown && (
          <>
            <span className="stat add">+{sum(shown, 'insert')}</span>
            <span className="stat del">−{sum(shown, 'delete')}</span>
          </>
        )}
        {commits.length > 0 && (
          <span className="muted" title="Commits on this branch">
            ↑{commits.length}
          </span>
        )}
        <button className="icon-button" disabled={busy} onClick={load} aria-label="Refresh">
          <Icon name="refresh" size={14} />
        </button>
      </header>

      <div className="commit-box">
        <div className="commit-input">
          <textarea
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            // Enter commits; Shift-Enter starts a new line for the body.
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey) return
              e.preventDefault()
              void commit()
            }}
            placeholder="Commit message"
          />
          {canSuggest && (
            <button
              className="icon-button"
              disabled={busy || suggesting}
              onClick={suggest}
              aria-label="Write the message with Claude"
              title="Write the message with Claude"
            >
              {suggesting ? <span className="spinner" /> : <Icon name="sparkles" size={14} />}
            </button>
          )}
        </div>
        <div className="split-button">
          <button className="secondary accent" disabled={busy} onClick={() => void commit()}>
            <Icon name="commit" size={14} />
            Commit
          </button>
          <button
            className="secondary"
            disabled={busy}
            aria-label="More actions"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <Icon name="chevron" size={13} />
          </button>
          {menuOpen && (
            <div className="menu" role="menu">
              {menu.map(([label, run]) => (
                <button
                  key={label}
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    void run()
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {check && (
        <details className={`check-bar ${check.ok ? 'ok' : 'failed'}`}>
          <summary>
            <span className="check-label">
              <Icon name={check.ok ? 'check' : 'x'} size={13} />
              {check.ok ? '.troy/check passed' : '.troy/check failed'}
            </span>
            <button className="secondary" disabled={busy} onClick={recheck}>
              Run again
            </button>
            {!check.ok && (
              <button
                className="primary"
                disabled={!canSend}
                title={canSend ? undefined : 'Start the agent first'}
                onClick={(e) => {
                  e.preventDefault()
                  onSendCheck()
                }}
              >
                <Icon name="send" size={14} />
                Send failure to agent
              </button>
            )}
          </summary>
          <pre>{check.output || '(no output)'}</pre>
        </details>
      )}
      {comments.length > 0 && (
        <div className="comment-bar">
          <span className="comment-count">
            {comments.length} comment{comments.length === 1 ? '' : 's'}
          </span>
          <button
            className="primary"
            disabled={!canSend}
            title={canSend ? undefined : 'Start the agent first'}
            onClick={onSend}
          >
            <Icon name="send" size={14} />
            Send to agent <kbd>{`${MOD}↵`}</kbd>
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {filter && (
        <div className="filter-bar" role="status">
          <span>Showing only: {filter.label}</span>
          <button className="secondary" onClick={onClearFilter}>
            Show all
          </button>
        </div>
      )}

      {!!shown?.length && (
        <details className="git-section" open>
          <summary>
            Changes <span className="count">{shown.length}</span>
          </summary>
          <ul className="change-list">
            {shown.map((file) => {
              const name = fileName(file)
              const slash = name.lastIndexOf('/')
              return (
                <li key={name}>
                  <button onClick={() => scrollTo(name)} title={name}>
                    <span className="change-name">{name.slice(slash + 1)}</span>
                    <span className="change-dir">{slash > 0 ? name.slice(0, slash) : ''}</span>
                    <span className="stat add">+{countChanges(file, 'insert')}</span>
                    <span className="stat del">−{countChanges(file, 'delete')}</span>
                    <span className="change-badge">{BADGES[file.type]}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </details>
      )}
      {commits.length > 0 && (
        <details className="git-section">
          <summary>
            Commits <span className="count">{commits.length}</span>
          </summary>
          <ul className="commit-list">
            {commits.map((c) => (
              <li key={c.hash}>
                <code>{c.hash}</code>
                <span className="commit-subject">{c.subject}</span>
                <span className="muted">{c.when}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <DiffView
        files={shown}
        comments={comments}
        onComments={onComments}
        placeholder="Comment for the agent (Enter saves)"
      />
    </div>
  )
}
