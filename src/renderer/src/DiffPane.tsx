import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import {
  Diff,
  Hunk,
  computeNewLineNumber,
  computeOldLineNumber,
  getChangeKey,
  type ChangeData,
  type FileData
} from 'react-diff-view'
import 'react-diff-view/style/index.css'
import type { CheckResult } from '../../shared/types'
import type { ReviewComment } from './comments'
import { Icon } from './icons'
import { parseFiles } from './diff'
import { MOD } from './platform'

/** Narrows the diff to some files, e.g. the ones another worktree also changed. */
export interface DiffFilter {
  files: string[]
  label: string
}

interface Props {
  path: string
  visible: boolean
  /** Changes whenever the diff may be stale, e.g. the agent's status moved. */
  refreshKey: string
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

const fileName = (file: FileData): string => (file.type === 'delete' ? file.oldPath : file.newPath)

const countChanges = (file: FileData, type: ChangeData['type']): number =>
  file.hunks.reduce((n, hunk) => n + hunk.changes.filter((c) => c.type === type).length, 0)

function toComment(file: string, change: ChangeData, text: string): ReviewComment {
  const removed = change.type === 'delete'
  return {
    file,
    changeKey: getChangeKey(change),
    line: removed ? computeOldLineNumber(change) : computeNewLineNumber(change),
    removed,
    text
  }
}

function CommentForm({
  placeholder,
  onSave,
  onCancel
}: {
  placeholder: string
  onSave: (text: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Escape') onCancel()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const text = e.currentTarget.value.trim()
      if (text) onSave(text)
    }
  }
  return (
    <div className="comment-form">
      <textarea autoFocus rows={2} placeholder={placeholder} onKeyDown={onKeyDown} />
    </div>
  )
}

interface DiffViewProps {
  files: FileData[] | null | undefined
  comments: ReviewComment[]
  onComments: (comments: ReviewComment[]) => void
  placeholder: string
}

/** The files of a diff, with comments drafted by clicking a line's gutter. */
export function DiffView({
  files,
  comments,
  onComments,
  placeholder
}: DiffViewProps): React.JSX.Element {
  const [draft, setDraft] = useState<{ file: string; change: ChangeData } | null>(null)

  const widgetsFor = (file: string): Record<string, React.ReactNode> => {
    const widgets: Record<string, React.ReactNode> = {}
    for (const c of comments.filter((c) => c.file === file)) {
      widgets[c.changeKey] = (
        <div className="comment">
          <span>{c.text}</span>
          <button
            className="link"
            title="Delete comment"
            aria-label="Delete comment"
            onClick={() => onComments(comments.filter((other) => other !== c))}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )
    }
    if (draft?.file === file) {
      widgets[getChangeKey(draft.change)] = (
        <CommentForm
          placeholder={placeholder}
          onCancel={() => setDraft(null)}
          onSave={(text) => {
            onComments([...comments, toComment(file, draft.change, text)])
            setDraft(null)
          }}
        />
      )
    }
    return widgets
  }

  // Focusable so vim keys can scroll it.
  return (
    <div className="diff-files" tabIndex={0}>
      {files?.length === 0 && (
        <div className="pane-empty">
          <Icon name="check" size={22} />
          <p className="muted">No changes yet.</p>
        </div>
      )}
      {files?.map((file) => {
        const name = fileName(file)
        return (
          <section key={name} className="diff-file">
            <header className="diff-file-head">
              <Icon name="file" size={14} />
              <h3>{name}</h3>
              <span className="stat add">+{countChanges(file, 'insert')}</span>
              <span className="stat del">−{countChanges(file, 'delete')}</span>
            </header>
            <Diff
              viewType="unified"
              diffType={file.type}
              hunks={file.hunks}
              widgets={widgetsFor(name)}
              gutterEvents={{
                onClick: ({ change }) => change && setDraft({ file: name, change })
              }}
            >
              {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
            </Diff>
          </section>
        )
      })}
    </div>
  )
}

export function DiffPane({
  path,
  visible,
  refreshKey,
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
  const [files, setFiles] = useState<FileData[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const apply = useCallback((result: { diff?: string; error?: string }) => {
    if (result.error) return setError(result.error)
    setFiles(parseFiles(result.diff ?? ''))
  }, [])

  const shown = filter ? files?.filter((f) => filter.files.includes(fileName(f))) : files

  const load = (): Promise<void> => window.api.diff(path).then(apply)

  useEffect(() => {
    if (!visible) return
    let current = true
    window.api.diff(path).then((result) => current && apply(result))
    return () => {
      current = false
    }
  }, [visible, refreshKey, path, apply])

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

  const commit = async (): Promise<void> => {
    if (await act(() => window.api.commit(path, message), 'Committed.')) setMessage('')
  }

  return (
    <div className="diff-pane">
      <div className="diff-toolbar">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void commit()}
          placeholder="Commit message"
        />
        <button className="secondary accent" disabled={busy} onClick={commit}>
          <Icon name="commit" size={14} />
          Commit all
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => ship(() => window.api.push(path), 'Pushed.')}
        >
          <Icon name="upload" size={14} />
          Push
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            ship(() => window.api.openPullRequest(path), 'Opened the pull request in your browser.')
          }
        >
          <Icon name="pr" size={14} />
          Open PR
        </button>
        <button
          className="secondary square"
          disabled={busy}
          onClick={load}
          title="Refresh"
          aria-label="Refresh"
        >
          <Icon name="refresh" size={14} />
        </button>
      </div>

      {check && (
        <details className={`check-bar ${check.ok ? 'ok' : 'failed'}`}>
          <summary>
            <span className="check-label">
              {check.ok ? '✓ .troy/check passed' : '✗ .troy/check failed'}
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

      <DiffView
        files={shown}
        comments={comments}
        onComments={onComments}
        placeholder="Comment for the agent (Enter saves)"
      />
    </div>
  )
}
