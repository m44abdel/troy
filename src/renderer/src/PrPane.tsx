import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { CheckState, MergeMethod } from '../../shared/types'
import { Icon, type IconName } from './icons'
import type { PrState } from './usePr'

// The same wording as GitHub's own merge button.
const MERGE_LABELS: Record<MergeMethod, string> = {
  squash: 'Squash and merge',
  merge: 'Create merge commit',
  rebase: 'Rebase and merge'
}

const CHECK_ICONS: Record<CheckState, IconName> = {
  pass: 'check',
  fail: 'x',
  pending: 'circle',
  skipped: 'circleSlash'
}

interface Props {
  path: string
  state: PrState
  onRefresh: () => void
}

/** The branch's pull request: its state, checks and comments, and a merge button. */
export function PrPane({ path, state, onRefresh }: Props): React.JSX.Element {
  const { pr, merge } = state
  const [method, setMethod] = useState<MergeMethod | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (call: () => Promise<{ error?: string }>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    const result = await call()
    setBusy(false)
    if (result.error) setError(result.error)
    onRefresh()
    return !result.error
  }

  if (state.error) return <p className="error pr-empty">{state.error}</p>
  if (pr === undefined) return <p className="muted pr-empty">Looking for a pull request…</p>
  if (pr === null)
    return (
      <p className="muted pr-empty">
        This branch has no pull request yet. Open one from Source Control.
      </p>
    )

  const chosen = method ?? merge?.preferred ?? 'squash'
  const mergeNow = async (): Promise<void> => {
    if (!window.confirm(`${MERGE_LABELS[chosen]} PR #${pr.number} on GitHub?`)) return
    await run(() => window.api.mergePr(path, pr.number, chosen))
  }
  const post = async (): Promise<void> => {
    if (draft && (await run(() => window.api.commentPr(path, pr.number, draft)))) setDraft(null)
  }

  return (
    <div className="pr-pane">
      <header className="pr-head">
        <Icon name="pr" size={14} />
        <a className="pr-number" href={pr.url} target="_blank" rel="noreferrer">
          #{pr.number}
        </a>
        <span className={`pr-state ${pr.state.toLowerCase()}`}>
          {pr.isDraft ? 'DRAFT' : pr.state}
        </span>
        <span className="tab-strip-fill" />
        <button className="icon-button" onClick={onRefresh} aria-label="Refresh">
          <Icon name="refresh" size={14} />
        </button>
      </header>
      <h3 className="pr-title">{pr.title}</h3>
      <p className="muted pr-updated">Updated {new Date(pr.updatedAt).toLocaleString()}</p>
      {pr.state === 'OPEN' && merge && (
        <div className="split-button pr-merge">
          <button className="primary" disabled={busy} onClick={mergeNow}>
            <Icon name="merge" size={14} />
            {MERGE_LABELS[chosen]}
          </button>
          <button
            className="primary"
            disabled={busy}
            aria-label="Merge method"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <Icon name="chevron" size={13} />
          </button>
          {menuOpen && (
            <div className="menu" role="menu">
              {merge.allowed.map((m) => (
                <button
                  key={m}
                  role="menuitemradio"
                  aria-checked={m === chosen}
                  onClick={() => {
                    setMethod(m)
                    setMenuOpen(false)
                  }}
                >
                  {MERGE_LABELS[m]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {pr.mergeable === 'CONFLICTING' && (
        <p className="pr-conflict">This branch has conflicts with its base.</p>
      )}
      {error && <p className="error">{error}</p>}

      <section className="pr-section">
        <h4>Checks</h4>
        {pr.checks.length === 0 ? (
          <p className="muted">No checks configured</p>
        ) : (
          <ul className="pr-checks">
            {pr.checks.map((c) => (
              <li key={c.name} className={`check-${c.state}`}>
                <Icon name={CHECK_ICONS[c.state]} size={13} />
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer">
                    {c.name}
                  </a>
                ) : (
                  c.name
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="pr-section">
        <h4>
          <Icon name="message" size={13} />
          Comments
          <span className="tab-strip-fill" />
          <button
            className="icon-button"
            aria-label="Add a comment"
            onClick={() => setDraft((d) => (d === null ? '' : d))}
          >
            <Icon name="plus" size={14} />
          </button>
        </h4>
        {draft !== null && (
          <div className="pr-draft">
            <textarea
              autoFocus
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Comment on the pull request"
            />
            <div className="pr-draft-actions">
              <button className="secondary" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button className="primary" disabled={busy || !draft.trim()} onClick={post}>
                Comment
              </button>
            </div>
          </div>
        )}
        {pr.comments.map((c, i) => (
          <article key={i} className="pr-comment">
            <header>
              <strong>@{c.author}</strong>
              <span className="muted">{new Date(c.createdAt).toLocaleString()}</span>
            </header>
            <div className="markdown">
              <Markdown remarkPlugins={[remarkGfm]}>{c.body}</Markdown>
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}
