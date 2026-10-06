import type { AgentStatus } from '../../shared/status'
import { isAlive } from '../../shared/status'
import type { CheckResult, Knowledge, WorktreeView } from '../../shared/types'
import type { ReviewComment } from './comments'
import { DiffPane } from './DiffPane'
import { DocsPane } from './DocsPane'
import { KnowledgePane } from './KnowledgePane'
import { Icon, type IconName } from './icons'
import { MOD } from './platform'
import { Terminal } from './Terminal'
import { agentId, shellId } from './terminals'
import { STATUS_LABELS } from './statusLabels'
import { AgentBadge } from './WorktreeCard'

const SETUP_COMMAND = 'sh .troy/setup.sh\r'

export type ColumnTab = 'shell' | 'diff' | 'knowledge' | 'docs'

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
  onToggleColumn: () => void
  firstRun?: FirstRun
  status?: AgentStatus
  onStatus: (path: string, status: AgentStatus, certain: boolean) => void
  comments: ReviewComment[]
  onComments: (path: string, comments: ReviewComment[]) => void
  onSend: (path: string) => void
  check?: CheckResult
  onRunCheck: (path: string) => Promise<CheckResult | null>
  onSendCheck: (path: string) => void
  /** Shared by every worktree of the repo. */
  knowledge?: Knowledge | { error: string }
  onKnowledgeChanged: () => void
}

export function Workspace({
  wt,
  active,
  showColumn,
  tab,
  onTab,
  onToggleColumn,
  firstRun,
  status,
  onStatus,
  comments,
  onComments,
  onSend,
  check,
  onRunCheck,
  onSendCheck,
  knowledge,
  onKnowledgeChanged
}: Props): React.JSX.Element {
  const pending = knowledge && 'proposals' in knowledge ? knowledge.proposals.length : 0
  const tabButton = (
    name: ColumnTab,
    icon: IconName,
    label: string,
    key?: string
  ): React.JSX.Element => (
    <button className={`tab ${tab === name ? 'active' : ''}`} onClick={() => onTab(name)}>
      <Icon name={icon} size={14} />
      {label}
      {key && <kbd>{`${MOD}${key}`}</kbd>}
    </button>
  )
  const branch = wt.branch ?? 'detached'
  const state = status ?? 'idle'

  return (
    <div className="workspace" style={{ display: active ? 'flex' : 'none' }}>
      <div className="pane pane-agent">
        <header className="pane-header">
          <span className={`status-pill ${state}`}>
            <span className={`dot ${state}`} />
            {STATUS_LABELS[state]}
          </span>
          <span className="pane-title">{wt.title ?? branch}</span>
          {wt.title && (
            <span className="branch-chip">
              <Icon name="branch" size={12} />
              {branch}
            </span>
          )}
          <AgentBadge agent={wt.agent} />
          <button
            className={`icon-button ${showColumn ? 'on' : ''}`}
            onClick={onToggleColumn}
            title={`Toggle side panel (${MOD}\\)`}
            aria-label="Toggle side panel"
            aria-pressed={showColumn}
          >
            <Icon name="panel" />
          </button>
        </header>
        <Terminal
          id={agentId(wt.path)}
          cwd={wt.path}
          port={wt.port}
          command={wt.agent}
          args={wt.agentArgs}
          prompt={firstRun?.prompt || undefined}
          onStatus={(s, certain) => onStatus(wt.path, s, certain)}
        />
      </div>
      <div className="column" style={{ display: showColumn ? 'flex' : 'none' }}>
        <div className="tabs">
          {tabButton('shell', 'terminal', 'Shell', 'E')}
          {tabButton('diff', 'diff', comments.length ? `Diff · ${comments.length}` : 'Diff', 'D')}
          {tabButton('docs', 'book', 'Docs')}
          {tabButton('knowledge', 'sparkles', pending ? `Knowledge · ${pending}` : 'Knowledge')}
        </div>
        <div className="pane pane-shell" style={{ display: tab === 'shell' ? 'block' : 'none' }}>
          <Terminal
            id={shellId(wt.path)}
            cwd={wt.path}
            port={wt.port}
            initialInput={firstRun?.setup ? SETUP_COMMAND : undefined}
          />
        </div>
        <div className="pane" style={{ display: tab === 'docs' ? 'block' : 'none' }}>
          <DocsPane path={wt.path} visible={active && showColumn && tab === 'docs'} />
        </div>
        <div className="pane" style={{ display: tab === 'knowledge' ? 'block' : 'none' }}>
          <KnowledgePane path={wt.path} knowledge={knowledge} onChanged={onKnowledgeChanged} />
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
            check={check}
            onRunCheck={() => onRunCheck(wt.path)}
            onSendCheck={() => onSendCheck(wt.path)}
          />
        </div>
      </div>
    </div>
  )
}
