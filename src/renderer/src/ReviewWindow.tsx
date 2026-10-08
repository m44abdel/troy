import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReviewEvent, ReviewMeta } from '../../shared/types'
import { formatComments, type ReviewComment } from './comments'
import { DiffView } from './DiffPane'
import { parseFiles } from './diff'
import { Icon } from './icons'
import { Splitter } from './Splitter'
import { Terminal } from './Terminal'
import { agentId, drawerId, focusTerminal, submitToTerminal } from './terminals'
import { TerminalDrawer } from './TerminalDrawer'
import { useDrawer } from './useDrawer'

const AGENT = 'claude'
const AGENT_SHARE = { initial: 45, min: 20, max: 80 }

interface Review {
  path: string
  diff: string
  meta: ReviewMeta
  agentArgs: string
  resume: string
}

const VERDICTS: { event: ReviewEvent; label: string; className: string }[] = [
  { event: 'COMMENT', label: 'Comment', className: 'secondary' },
  { event: 'REQUEST_CHANGES', label: 'Request changes', className: 'secondary' },
  { event: 'APPROVE', label: 'Approve', className: 'primary' }
]

const openingPrompt = (m: ReviewMeta): string =>
  [
    `Help me review PR #${m.number} "${m.title}" by @${m.author} into ${m.base} (${m.url}).`,
    `This folder is a checkout of the PR's head. \`gh pr diff ${m.number}\` shows its changes.`,
    m.body.trim() && `Its description:\n${m.body.trim()}`,
    'Start with a short summary of what it changes and what looks risky, then wait for my ' +
      "questions. Don't post anything to GitHub; I submit the review myself."
  ]
    .filter(Boolean)
    .join('\n\n')

/** A window for one PR: its diff and your draft comments beside a Claude session in its checkout. */
export function ReviewWindow({
  repo,
  number
}: {
  repo: string
  number: number
}): React.JSX.Element {
  const [review, setReview] = useState<Review | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [comments, setComments] = useState<ReviewComment[]>([])
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [agentShare, setAgentShare] = useState(AGENT_SHARE.initial)
  const root = useRef<HTMLDivElement>(null)
  const { open: drawerOpen, setOpen: setDrawerOpen, height, setHeight } = useDrawer()
  const files = useMemo(() => (review ? parseFiles(review.diff) : null), [review])

  useEffect(() => {
    document.title = `Review #${number}`
    window.api.openReview(repo, number).then(({ error, ...r }) => {
      if (error) return setError(error)
      setReview(r as Review)
      document.title = `Review #${number} · ${r.meta?.title}`
    })
  }, [repo, number])

  const toggleDrawer = useCallback(() => {
    setDrawerOpen((was) => !was)
    if (!drawerOpen && review) requestAnimationFrame(() => focusTerminal(drawerId(review.path)))
  }, [drawerOpen, setDrawerOpen, review])

  useEffect(
    () => window.api.onAction((action) => action === 'toggleTerminal' && toggleDrawer()),
    [toggleDrawer]
  )

  const submit = async (event: ReviewEvent): Promise<void> => {
    setBusy(true)
    setError(null)
    const result = await window.api.submitReview(repo, number, event, body, comments)
    setBusy(false)
    if (result.error) return setError(result.error)
    window.close()
  }

  const askAgent = (): void => {
    if (!review) return
    const heading = 'My draft review comments. What do you think of them?'
    submitToTerminal(agentId(review.path), formatComments(comments, heading))
  }

  if (!review)
    return (
      <div className="review">
        <header className="review-header">
          <span className="pane-title">Review #{number}</span>
        </header>
        {error ? <p className="error">{error}</p> : <p className="muted">Checking out the PR…</p>}
      </div>
    )

  const { meta } = review
  return (
    <div className="review">
      <header className="review-header">
        <span className="pane-title">
          #{meta.number} {meta.title}
        </span>
        <span className="branch-chip">@{meta.author}</span>
        <span className="branch-chip">
          <Icon name="branch" size={12} />
          {meta.base}
        </span>
        <a className="link" href={meta.url} target="_blank" rel="noreferrer">
          <Icon name="pr" size={14} /> GitHub
        </a>
      </header>
      <div
        className="workspace"
        ref={root}
        style={{ display: 'flex', '--agent-share': agentShare } as React.CSSProperties}
      >
        <div className="column">
          <div className="diff-pane">
            <div className="review-submit">
              <textarea
                rows={2}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Review summary (optional)"
              />
              <div className="review-actions">
                <span className="comment-count">
                  {comments.length} comment{comments.length === 1 ? '' : 's'}
                </span>
                <button className="secondary" disabled={!comments.length} onClick={askAgent}>
                  <Icon name="send" size={14} />
                  Ask Claude
                </button>
                {VERDICTS.map((v) => (
                  <button
                    key={v.event}
                    className={v.className}
                    disabled={busy}
                    onClick={() => submit(v.event)}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
            {error && <p className="error">{error}</p>}
            <DiffView
              files={files}
              comments={comments}
              onComments={setComments}
              placeholder="Comment for the PR (Enter saves)"
            />
          </div>
          <TerminalDrawer
            id={drawerId(review.path)}
            cwd={review.path}
            open={drawerOpen}
            onToggle={toggleDrawer}
            height={height}
            onHeight={setHeight}
          />
        </div>
        <Splitter
          label="Resize diff and agent"
          value={agentShare}
          min={AGENT_SHARE.min}
          max={AGENT_SHARE.max}
          onMove={(x) => {
            const box = root.current?.getBoundingClientRect()
            if (!box?.width) return
            const share = 100 - ((x - box.left) / box.width) * 100
            setAgentShare(Math.min(AGENT_SHARE.max, Math.max(AGENT_SHARE.min, share)))
          }}
          onReset={() => setAgentShare(AGENT_SHARE.initial)}
        />
        <div className="pane-agent">
          <Terminal
            id={agentId(review.path)}
            cwd={review.path}
            command={AGENT}
            args={review.agentArgs}
            resume={review.resume}
            // A PR reviewed before picks up that conversation instead of starting over.
            prompt={review.resume ? undefined : openingPrompt(meta)}
          />
        </div>
      </div>
    </div>
  )
}
