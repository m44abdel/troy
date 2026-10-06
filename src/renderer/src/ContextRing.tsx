import type { ContextUsage } from '../../shared/types'
import { CONTEXT_WARN_PERCENT, contextPercent, describeContext } from './context'

const RADIUS = 5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** A small ring that fills as the agent's context window does; details on hover. */
export function ContextRing({ usage }: { usage: ContextUsage }): React.JSX.Element {
  const percent = contextPercent(usage)
  const isFull = percent >= CONTEXT_WARN_PERCENT
  const title = [
    describeContext(usage),
    usage.model,
    isFull && 'Compact (e.g. /compact) or start a fresh session soon.'
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <svg className={`ctx-ring ${isFull ? 'warn' : ''}`} viewBox="0 0 14 14" role="img">
      <title>{title}</title>
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
  )
}
