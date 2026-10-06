import type { AgentStatus } from '../../shared/status'
import { isAlive } from '../../shared/status'
import type { ContextUsage, WorktreeView } from '../../shared/types'
import type { ReviewComment } from './comments'
import { ContextPane } from './ContextPane'
import { DiffPane } from './DiffPane'
import { MOD } from './platform'
import { Terminal } from './Terminal'
import { agentId, shellId } from './terminals'

const SETUP_COMMAND = 'sh .troy/setup.sh\r'

export type ColumnTab = 'shell' | 'diff' | 'context'

/** What a worktree created this session still needs on its first launch. */
export interface FirstRun {
  prompt: string
  setup: boolean
}

interface Props {
  wt: WorktreeView
  active: boolean
  showColumn: boolean
  tab: ColumnTab
  onTab: (tab: ColumnTab) => void
  firstRun?: FirstRun
  status?: AgentStatus
  context?: ContextUsage | null
  onStatus: (path: string, status: AgentStatus) => void
  comments: ReviewComment[]
  onComments: (path: string, comments: ReviewComment[]) => void
  onSend: (path: string) => void
}

export function Workspace({
  wt,
  active,
  showColumn,
  tab,
  onTab,
  firstRun,
  status,
  context,
  onStatus,
  comments,
  onComments,
  onSend
}: Props): React.JSX.Element {
  const tabButton = (name: ColumnTab, label: string, key?: string): React.JSX.Element => (
    <button className={`tab ${tab === name ? 'active' : ''}`} onClick={() => onTab(name)}>
      {label} {key && <kbd>{`${MOD}${key}`}</kbd>}
    </button>
  )

  return (
    <div className="workspace" style={{ display: active ? 'flex' : 'none' }}>
      <div className="pane pane-agent">
        <Terminal
          id={agentId(wt.path)}
          cwd={wt.path}
          port={wt.port}
          command={wt.agent}
          prompt={firstRun?.prompt || undefined}
          onStatus={(s) => onStatus(wt.path, s)}
        />
      </div>
      <div className="column" style={{ display: showColumn ? 'flex' : 'none' }}>
        <div className="tabs">
          {tabButton('shell', 'Shell', 'E')}
          {tabButton('diff', comments.length ? `Diff · ${comments.length}` : 'Diff', 'D')}
          {tabButton('context', 'Context')}
        </div>
        <div className="pane pane-shell" style={{ display: tab === 'shell' ? 'block' : 'none' }}>
          <Terminal
            id={shellId(wt.path)}
            cwd={wt.path}
            port={wt.port}
            initialInput={firstRun?.setup ? SETUP_COMMAND : undefined}
          />
        </div>
        <div className="pane" style={{ display: tab === 'context' ? 'block' : 'none' }}>
          <ContextPane agent={wt.agent} usage={context} />
        </div>
        <div className="pane pane-diff" style={{ display: tab === 'diff' ? 'flex' : 'none' }}>
          <DiffPane
            path={wt.path}
            visible={active && showColumn && tab === 'diff'}
            refreshKey={status ?? 'idle'}
            comments={comments}
            onComments={(c) => onComments(wt.path, c)}
            canSend={isAlive(status)}
            onSend={() => onSend(wt.path)}
          />
        </div>
      </div>
    </div>
  )
}
