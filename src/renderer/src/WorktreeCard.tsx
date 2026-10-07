import type { OverlapKind } from '../../shared/overlap'
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

const files = (n: number): string => `${n} file${n === 1 ? '' : 's'}`

// Count and relation first, name last: a narrow sidebar cuts the end off.
const OVERLAP_TEXT: Record<OverlapKind, (n: number, name: string) => string> = {
  same: (n, name) => `⚠ ${files(n)} shared with ${name}`,
  uses: (n, name) => `↳ ${files(n)} ${n === 1 ? 'uses' : 'use'} changes in ${name}`,
  usedBy: (n, name) => `↳ ${files(n)} used by ${name}`
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
  /** Other worktrees whose changes meet this one's. */
  overlaps?: { name: string; kind: OverlapKind; files: string[] }[]
  onSelect: () => void
  /** Opens the diff narrowed to an overlap's files, with its line as the label. */
  onOverlap: (files: string[], label: string) => void
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
  onSelect,
  onOverlap
}: Props): React.JSX.Element {
  const branch = wt.branch ?? 'detached'
  return (
    // Overlap lines are buttons of their own, so the card can't be one; its main button
    // stretches over the whole card instead.
    <div
      className={`worktree card ${status} ${selected ? 'selected' : ''} ${needsYou ? 'needs-you' : ''}`}
      title={wt.path}
      data-path={wt.path}
    >
      <button className="card-select" onClick={onSelect}>
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
      </button>
      {overlaps.map((o) => {
        const label = OVERLAP_TEXT[o.kind](o.files.length, o.name)
        return (
          <button
            key={`${o.kind}:${o.name}`}
            className={`card-overlap ${o.kind}`}
            title={`${o.files.join('\n')}\n\nClick to see these changes`}
            onClick={() => onOverlap(o.files, label)}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
