import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { ContextUsage } from '../../shared/types'
import { CONTEXT_WARN_PERCENT, contextPercent, formatTokens } from './context'

const RADIUS = 5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** A small ring that fills as the agent's context window does; hover shows the numbers. */
export function ContextRing({ usage }: { usage: ContextUsage }): React.JSX.Element {
  const percent = contextPercent(usage)
  const isFull = percent >= CONTEXT_WARN_PERCENT
  const tokens = `${formatTokens(usage.used)} of ${formatTokens(usage.window)} tokens`
  // The card clips overflow and lifts on hover, so the popup renders at the page level.
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  return (
    <span
      className="ctx"
      onMouseEnter={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setAnchor(null)}
    >
      <svg
        className={`ctx-ring ${isFull ? 'warn' : ''}`}
        viewBox="0 0 14 14"
        role="img"
        aria-label={`${percent}% of context used, ${tokens}`}
      >
        <circle cx="7" cy="7" r={RADIUS} className="track" />
        <circle
          cx="7"
          cy="7"
          r={RADIUS}
          className="fill"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)}
        />
      </svg>
      {anchor &&
        createPortal(
          <div
            className={`ctx-tip ${isFull ? 'warn' : ''}`}
            role="tooltip"
            style={{ left: anchor.left + anchor.width / 2, top: anchor.top }}
          >
            <strong>{percent}% of context used</strong>
            <span>{tokens}</span>
            {usage.model && <span className="muted">{usage.model}</span>}
            {isFull && <span>Compact (/compact) or start a fresh session soon.</span>}
          </div>,
          document.body
        )}
    </span>
  )
}
