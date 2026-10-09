import type { AgentStatus } from '../../shared/status'
import { groupByStatus, LANES } from './lanes'
import { STATUS_LABELS } from './statusLabels'

interface Props<T> {
  items: T[]
  status: (item: T) => AgentStatus
  card: (item: T) => React.ReactNode
}

/** Every open worktree in one lane per agent status; lanes follow live status, so nothing drags. */
export function Board<T>({ items, status, card }: Props<T>): React.JSX.Element {
  const lanes = groupByStatus(items, status)
  return (
    <div className="board">
      {LANES.map((lane) => (
        <section key={lane} className="board-lane" aria-label={STATUS_LABELS[lane]}>
          <h3>
            <span className={`dot ${lane}`} />
            {STATUS_LABELS[lane]}
            <span className="count">{lanes[lane].length}</span>
          </h3>
          {lanes[lane].map(card)}
        </section>
      ))}
    </div>
  )
}
