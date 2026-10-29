import { useRef } from 'react'
import type { AgentStatus } from '../../shared/status'
import { HARVEST_PROMPT } from '../../shared/harvest'
import { isAlive } from '../../shared/status'
import type { CheckResult, Knowledge, Repo, WorktreeView } from '../../shared/types'
import type { ReviewComment } from './comments'
import { commandName } from '../../shared/shell'
import type { DiffFilter } from './DiffPane'
import { DocsPane } from './DocsPane'
import { FilesPane } from './FilesPane'
import { GitPane } from './GitPane'
import { KnowledgePane } from './KnowledgePane'
import { COLUMN } from './layout'
import { Icon, type IconName } from './icons'
import { MOD } from './platform'
import { PrPane } from './PrPane'
import { SessionsPane } from './SessionsPane'
import { usePr } from './usePr'
import { Splitter } from './Splitter'
import { TerminalArea } from './TerminalArea'
import { agentId, submitToTerminal } from './terminals'
import { STATUS_LABELS } from './statusLabels'
import { AgentBadge } from './WorktreeCard'

export type ColumnTab = 'files' | 'sessions' | 'git' | 'pr' | 'docs' | 'knowledge'

/** What a worktree created this session still needs on its first launch. */
export interface FirstRun {
  prompt: string
  setup: boolean
  /** Launch the agent without waiting for Enter: nobody is watching a spawned one start. */
  autoStart?: boolean
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
  columnWidth: number
  /** `done` once the drag ends. */
  onColumnWidth: (width: number, done: boolean) => void
  onResetColumnWidth: () => void
  diffFilter?: DiffFilter
  onClearDiffFilter: () => void
  /** Shared by every worktree of the repo. */
  knowledge?: Knowledge | { error: string }
  onKnowledgeChanged: () => void
  /** Closing the agent's pane or tab closes the session, like the card's ×. */
  onCloseSession: () => void
  /** Bumped by Cmd-Shift-F. */
  filesSearch: number
  repos: Repo[]
  onOpenWorktree: (path: string) => void
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
  columnWidth,
  onColumnWidth,
  onResetColumnWidth,
  diffFilter,
  onClearDiffFilter,
  knowledge,
  onKnowledgeChanged,
  onCloseSession,
  filesSearch,
  repos,
  onOpenWorktree
}: Props): React.JSX.Element {
  const pending = knowledge && 'proposals' in knowledge ? knowledge.proposals.length : 0
  // Icons only, like Orca's right sidebar; the name and any count are in the label.
  const tabButton = (
    name: ColumnTab,
    icon: IconName,
    title: string,
    { count = 0, key }: { count?: number; key?: string } = {}
  ): React.JSX.Element => {
    const label = count ? `${title} · ${count}` : title
    return (
      <button
        className={`tab icon-tab ${tab === name ? 'active' : ''}`}
        onClick={() => onTab(name)}
        aria-label={label}
        title={key ? `${label} (${MOD}${key})` : label}
      >
        <Icon name={icon} size={15} />
        {count > 0 && <span className="tab-count">{count}</span>}
      </button>
    )
  }
  const branch = wt.branch ?? 'detached'
  const state = status ?? 'idle'
  const column = useRef<HTMLDivElement>(null)
  const sidePanel = active && showColumn
  const [pr, refreshPr] = usePr(wt.path, sidePanel && (tab === 'git' || tab === 'pr'))

  return (
    <div className="workspace" style={{ display: active ? 'flex' : 'none' }}>
      <TerminalArea
        path={wt.path}
        port={wt.port}
        visible={active}
        agent={{
          command: wt.agent,
          args: wt.agentArgs,
          resume: wt.resume,
          prompt: firstRun?.prompt || undefined,
          autoStart: firstRun?.autoStart,
          onStatus: (s, certain) => onStatus(wt.path, s, certain)
        }}
        agentTitle={
          <>
            <span className={`dot ${state}`} aria-label={STATUS_LABELS[state]} />
            {wt.title ?? branch}
          </>
        }
        firstRun={firstRun && { setup: firstRun.setup }}
        onCloseAgent={onCloseSession}
        toolbar={
          <>
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
              title={`Toggle side panel (${MOD}L)`}
              aria-label="Toggle side panel"
              aria-pressed={showColumn}
            >
              <Icon name="panel" />
            </button>
          </>
        }
      />
      {showColumn && (
        <Splitter
          label="Resize agent and side panel"
          value={columnWidth}
          min={COLUMN.min}
          max={COLUMN.max}
          onMove={(x, done) => {
            const right = column.current?.getBoundingClientRect().right
            if (right) onColumnWidth(right - x, done)
          }}
          onReset={onResetColumnWidth}
        />
      )}
      <div className="column" ref={column} style={{ display: showColumn ? 'flex' : 'none' }}>
        <div className="tabs">
          {tabButton('files', 'files', 'Files', { key: '⇧E' })}
          {tabButton('sessions', 'grid', 'Agent sessions')}
          {tabButton('git', 'branch', 'Source control', { count: comments.length, key: '⇧G' })}
          {tabButton('pr', 'listChecks', 'Pull request')}
          {tabButton('docs', 'book', 'Docs')}
          {tabButton('knowledge', 'library', 'Knowledge', { count: pending })}
          <button
            className="icon-button tabs-hide"
            onClick={onToggleColumn}
            title={`Hide side panel (${MOD}L)`}
            aria-label="Hide side panel"
          >
            <Icon name="panel" />
          </button>
        </div>
        <div className="pane" style={{ display: tab === 'files' ? 'block' : 'none' }}>
          <FilesPane
            path={wt.path}
            visible={sidePanel && tab === 'files'}
            refreshKey={status ?? 'idle'}
            searchNonce={filesSearch}
          />
        </div>
        <div className="pane" style={{ display: tab === 'sessions' ? 'block' : 'none' }}>
          <SessionsPane
            path={wt.path}
            repos={repos}
            visible={sidePanel && tab === 'sessions'}
            onOpenWorktree={onOpenWorktree}
          />
        </div>
        <div className="pane" style={{ display: tab === 'docs' ? 'block' : 'none' }}>
          <DocsPane path={wt.path} visible={sidePanel && tab === 'docs'} />
        </div>
        <div className="pane" style={{ display: tab === 'knowledge' ? 'block' : 'none' }}>
          <KnowledgePane
            path={wt.path}
            knowledge={knowledge}
            onChanged={onKnowledgeChanged}
            onHarvest={async () => {
              // A running agent already has the session in mind; a finished one is resumed
              // in a throwaway fork.
              if (isAlive(status) && submitToTerminal(agentId(wt.path), HARVEST_PROMPT))
                return { notice: 'Asked the agent. Its proposals will appear here for review.' }
              const { proposed, error } = await window.api.harvestKnowledge(wt.path)
              if (error) return { error }
              return {
                notice: proposed
                  ? `The agent proposed ${proposed} fact${proposed === 1 ? '' : 's'} for review.`
                  : 'The agent found nothing new worth proposing.'
              }
            }}
          />
        </div>
        <div className="pane" style={{ display: tab === 'pr' ? 'block' : 'none' }}>
          <PrPane path={wt.path} state={pr} onRefresh={refreshPr} />
        </div>
        <div className="pane pane-diff" style={{ display: tab === 'git' ? 'flex' : 'none' }}>
          <GitPane
            path={wt.path}
            branch={branch}
            canSuggest={commandName(wt.agent) === 'claude'}
            pr={pr.pr}
            visible={sidePanel && tab === 'git'}
            refreshKey={status ?? 'idle'}
            comments={comments}
            onComments={(c) => onComments(wt.path, c)}
            canSend={isAlive(status)}
            onSend={() => onSend(wt.path)}
            check={check}
            onRunCheck={() => onRunCheck(wt.path)}
            onSendCheck={() => onSendCheck(wt.path)}
            filter={diffFilter}
            onClearFilter={onClearDiffFilter}
          />
        </div>
      </div>
    </div>
  )
}
