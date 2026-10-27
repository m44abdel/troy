import { useState, type KeyboardEvent } from 'react'
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
import type { ReviewComment } from './comments'
import { countChanges, fileName } from './diff'
import { Icon } from './icons'

/** Narrows the diff to some files, e.g. the ones another worktree also changed. */
export interface DiffFilter {
  files: string[]
  label: string
}

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
