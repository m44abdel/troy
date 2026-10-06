import type { AgentStatus } from '../../shared/status'
import type { CheckResult, ContextUsage, WorktreeView } from '../../shared/types'
import { ContextRing } from './ContextRing'
import { MOD } from './platform'
import { STATUS_LABELS } from './statusLabels'

/** A stable hue per agent name, so each CLI gets its own avatar colour. */
const agentHue = (agent: string): number =>
  [...agent].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

export function AgentBadge({ agent }: { agent: string }): React.JSX.Element {
  const name = agent.split(/\s+/)[0].split('/').pop() ?? agent
  return (
    <span className="agent-badge" style={{ '--hue': agentHue(name) } as React.CSSProperties}>
      {name}
    </span>
  )
}

interface Props {
  wt: WorktreeView
  /** Position in the sidebar, for the ⌘1–9 hint. */
  index: number
  selected: boolean
  status: AgentStatus
  /** Waiting and not yet looked at. */
  needsYou: boolean
  usage?: ContextUsage | null
  check?: CheckResult
  /** Other worktrees that changed some of the same files. */
  overlaps?: { name: string; files: string[] }[]
  onSelect: () => void
}

export function WorktreeCard({
  wt,
  index,
  selected,
  status,
  needsYou,
  usage,
  check,
  overlaps = [],
  onSelect
}: Props): React.JSX.Element {
  const branch = wt.branch ?? 'detached'
  return (
    <button
      className={`worktree card ${status} ${selected ? 'selected' : ''} ${needsYou ? 'needs-you' : ''}`}
      onClick={onSelect}
      title={wt.path}
      data-path={wt.path}
    >
      <span className="card-head">
        {/* With a title, the branch moves up here; without one, the branch is the title. */}
        <span className="branch">{wt.title ? branch : wt.agent}</span>
        {index < 9 && <kbd>{`${MOD}${index + 1}`}</kbd>}
      </span>
      <span className="card-title">{wt.title ?? branch}</span>
      <span className="card-status">
        <span className={`dot ${status}`} />
        <span className="status-label">{STATUS_LABELS[status]}</span>
        {wt.title && <AgentBadge agent={wt.agent} />}
        {check && (
          <span
            className={`card-check ${check.ok ? 'ok' : 'failed'}`}
            title={check.ok ? '.troy/check passed' : '.troy/check failed'}
          >
            {check.ok ? '✓' : '✗'} check
          </span>
        )}
        {usage && <ContextRing usage={usage} />}
      </span>
      {overlaps.map((o) => (
        <span key={o.name} className="card-overlap" title={o.files.join('\n')}>
          ⚠ Same files as {o.name} ({o.files.length})
        </span>
      ))}
    </button>
  )
}
