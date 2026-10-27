import type { Repo, WorktreeView } from '../../shared/types'
import { Icon, Logo } from './icons'
import { MOD } from './platform'
import { ClosedList } from './WorktreeCard'

const HELP_URL = 'https://github.com/m44abdel/troy#readme'

const basename = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

interface Props {
  /** In the order the user arranged them. */
  repos: Repo[]
  closed: string[]
  folded: string[]
  onToggleFold: (repo: string) => void
  /** Repos with their closed list expanded. */
  showClosed: string[]
  onToggleClosed: (repo: string) => void
  onReopen: (path: string) => void
  needsYou: (path: string) => boolean
  waiting: number
  onClearWaiting: () => void
  error: string | null
  card: (wt: WorktreeView) => React.JSX.Element
  showBoard: boolean
  showTasks: boolean
  onSearch: () => void
  onTasks: () => void
  onAutomations: () => void
  onBoard: () => void
  onAddRepo: () => void
  onNewWorktree: (repo: string) => void
  onSettings: () => void
  onHide: () => void
}

/** Search, Tasks and Automations on top, then every repo's worktrees, like Orca's sidebar. */
export function Sidebar(props: Props): React.JSX.Element {
  const { repos, closed, folded, needsYou } = props
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="brand">
          <Logo size={22} />
          Troy
        </span>
        <button
          className="icon-button"
          onClick={props.onHide}
          title={`Hide sidebar (${MOD}B)`}
          aria-label="Hide sidebar"
        >
          <Icon name="sidebar" />
        </button>
      </div>
      <nav className="side-nav">
        <button className="nav-item nav-search" onClick={props.onSearch}>
          <Icon name="search" size={15} />
          Search
          <kbd>{MOD}J</kbd>
        </button>
        <button className="nav-item" aria-pressed={props.showTasks} onClick={props.onTasks}>
          <Icon name="listChecks" size={15} />
          Tasks
        </button>
        <button className="nav-item" onClick={props.onAutomations}>
          <Icon name="refresh" size={15} />
          Automations
        </button>
      </nav>
      <div className="projects-header">
        <span>Projects</span>
        <button
          className="icon-button"
          onClick={props.onBoard}
          title={`Board (${MOD}⇧B)`}
          aria-label="Board"
          aria-pressed={props.showBoard}
        >
          <Icon name="kanban" size={15} />
        </button>
        <button
          className="icon-button"
          onClick={props.onAddRepo}
          title={`Add repository (${MOD}O)`}
          aria-label="Add repository"
        >
          <Icon name="folderPlus" size={15} />
        </button>
      </div>
      <div className="repo-list">
        {repos.map((repo) => {
          const isFolded = folded.includes(repo.path)
          const waiting = repo.worktrees.filter((wt) => needsYou(wt.path)).length
          return (
            <section key={repo.path} className="repo">
              <div className="repo-header" title={repo.path}>
                <button
                  className="repo-toggle"
                  onClick={() => props.onToggleFold(repo.path)}
                  aria-expanded={!isFolded}
                >
                  <Icon name="chevron" size={13} />
                  <span className="repo-name">{basename(repo.path)}</span>
                </button>
                {/* Folded, the header still says when an agent inside needs you. */}
                {isFolded && waiting > 0 && (
                  <span className="count waiting">{waiting} waiting</span>
                )}
                <span className="count">{repo.worktrees.length}</span>
                <button
                  className="icon-button"
                  onClick={() => props.onNewWorktree(repo.path)}
                  title={`New worktree (${MOD}N)`}
                  aria-label={`New worktree in ${basename(repo.path)}`}
                >
                  <Icon name="plus" size={14} />
                </button>
              </div>
              {repo.error && <p className="error">{repo.error}</p>}
              {!isFolded &&
                repo.worktrees.filter((wt) => !closed.includes(wt.path)).map(props.card)}
              <ClosedList
                worktrees={repo.worktrees.filter((wt) => closed.includes(wt.path))}
                open={props.showClosed.includes(repo.path) && !isFolded}
                onToggle={() => props.onToggleClosed(repo.path)}
                onReopen={props.onReopen}
              />
            </section>
          )
        })}
      </div>
      {props.waiting > 0 && (
        <button className="link clear-waiting" onClick={props.onClearWaiting}>
          Clear all waiting
        </button>
      )}
      {props.error && <p className="error">{props.error}</p>}
      <footer className="sidebar-footer">
        <button
          className="icon-button"
          onClick={props.onSettings}
          title={`Settings (${MOD},)`}
          aria-label="Settings"
        >
          <Icon name="settings" size={15} />
        </button>
        <a
          className="icon-button"
          href={HELP_URL}
          target="_blank"
          rel="noreferrer"
          title="Help"
          aria-label="Help"
        >
          <Icon name="help" size={15} />
        </a>
      </footer>
    </aside>
  )
}
