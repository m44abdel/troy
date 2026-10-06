import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import {
  Diff,
  Hunk,
  computeNewLineNumber,
  computeOldLineNumber,
  getChangeKey,
  parseDiff,
  type ChangeData,
  type FileData
} from 'react-diff-view'
import 'react-diff-view/style/index.css'
import type { ReviewComment } from './comments'
import { MOD } from './platform'

interface Props {
  path: string
  visible: boolean
  /** Changes whenever the diff may be stale, e.g. the agent's status moved. */
  refreshKey: string
  comments: ReviewComment[]
  onComments: (comments: ReviewComment[]) => void
  canSend: boolean
  onSend: () => void
}

type Result = { error?: string }

const fileName = (file: FileData): string => (file.type === 'delete' ? file.oldPath : file.newPath)

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
  onSave,
  onCancel
}: {
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
      <textarea
        autoFocus
        rows={2}
        placeholder="Comment for the agent (Enter saves)"
        onKeyDown={onKeyDown}
      />
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
  onSend
}: Props): React.JSX.Element {
  const [files, setFiles] = useState<FileData[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [draft, setDraft] = useState<{ file: string; change: ChangeData } | null>(null)

  const apply = useCallback((result: { diff?: string; error?: string }) => {
    if (result.error) return setError(result.error)
    // parseDiff turns an empty string into one blank file, so skip it.
    setFiles(result.diff ? parseDiff(result.diff, { nearbySequences: 'zip' }) : [])
  }, [])

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

  const commit = async (): Promise<void> => {
    if (await act(() => window.api.commit(path, message), 'Committed.')) setMessage('')
  }

  const widgetsFor = (file: string): Record<string, React.ReactNode> => {
    const widgets: Record<string, React.ReactNode> = {}
    for (const c of comments.filter((c) => c.file === file)) {
      widgets[c.changeKey] = (
        <div className="comment">
          <span>{c.text}</span>
          <button
            className="link"
            title="Delete comment"
            onClick={() => onComments(comments.filter((other) => other !== c))}
          >
            ×
          </button>
        </div>
      )
    }
    if (draft?.file === file) {
      widgets[getChangeKey(draft.change)] = (
        <CommentForm
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

  return (
    <div className="diff-pane">
      <div className="diff-toolbar">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void commit()}
          placeholder="Commit message"
        />
        <button className="secondary" disabled={busy} onClick={commit}>
          Commit all
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => act(() => window.api.push(path), 'Pushed.')}
        >
          Push
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            act(() => window.api.openPullRequest(path), 'Opened the pull request in your browser.')
          }
        >
          Open PR
        </button>
        <button className="secondary" disabled={busy} onClick={load} title="Refresh">
          ↻
        </button>
      </div>

      {comments.length > 0 && (
        <div className="comment-bar">
          <span>
            {comments.length} comment{comments.length === 1 ? '' : 's'}
          </span>
          <button
            className="primary"
            disabled={!canSend}
            title={canSend ? undefined : 'Start the agent first'}
            onClick={onSend}
          >
            Send to agent <kbd>{`${MOD}↵`}</kbd>
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <div className="diff-files">
        {files?.length === 0 && <p className="muted">No changes yet.</p>}
        {files?.map((file) => {
          const name = fileName(file)
          return (
            <section key={name} className="diff-file">
              <h3>{name}</h3>
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
    </div>
  )
}
