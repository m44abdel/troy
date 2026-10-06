import type { ContextUsage } from '../../shared/types'
import { CONTEXT_WARN_PERCENT, contextPercent, formatTokens } from './context'

interface Props {
  agent: string
  usage: ContextUsage | null | undefined
}

export function ContextPane({ agent, usage }: Props): React.JSX.Element {
  if (!usage)
    return (
      <div className="context-pane">
        <p className="muted">
          No context usage for <strong>{agent}</strong> yet. Troy reads Claude Code and Codex
          session logs once the agent has replied; other CLIs show as unknown.
        </p>
      </div>
    )

  const percent = contextPercent(usage)
  const isFull = percent >= CONTEXT_WARN_PERCENT
  return (
    <div className="context-pane">
      <div className="context-figure">{percent}%</div>
      <div className={`ctx-meter ${isFull ? 'warn' : ''}`}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <dl>
        <dt>Used</dt>
        <dd>{formatTokens(usage.used)} tokens</dd>
        <dt>Window</dt>
        <dd>{formatTokens(usage.window)} tokens</dd>
        {usage.model && (
          <>
            <dt>Model</dt>
            <dd>{usage.model}</dd>
          </>
        )}
      </dl>
      {isFull && (
        <p className="error">
          Context is {percent}% full. Compact (e.g. /compact) or start a fresh session before the
          agent does it for you mid-task.
        </p>
      )}
    </div>
  )
}
