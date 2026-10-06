import type { AgentStatus } from '../../shared/status'
import type { ContextUsage, WorktreeView } from '../../shared/types'
import { ContextRing } from './ContextRing'
import { MOD } from './platform'

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'not started',
  running: 'working',
  waiting: 'waiting',
  done: 'finished',
  error: 'exited with an error'
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
  onSelect: () => void
}

export function WorktreeCard({
  wt,
  index,
  selected,
  status,
  needsYou,
  usage,
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
        {wt.title && <span className="agent">{wt.agent}</span>}
        {usage && <ContextRing usage={usage} />}
      </span>
    </button>
  )
}
