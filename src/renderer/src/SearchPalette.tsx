import { useEffect, useRef, useState } from 'react'
import type { Repo } from '../../shared/types'
import { Icon } from './icons'

const basename = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

interface Props {
  repos: Repo[]
  onPick: (path: string) => void
  onClose: () => void
}

/** Cmd-J: jump to any worktree by its title, branch or repo, like Orca's worktree switcher. */
export function SearchPalette({ repos, onPick, onClose }: Props): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  useEffect(() => dialog.current?.showModal(), [])

  const needle = query.trim().toLowerCase()
  const matches = repos
    .flatMap((repo) => repo.worktrees.map((wt) => ({ wt, repo: basename(repo.path) })))
    .filter(({ wt, repo }) =>
      `${wt.title ?? ''} ${wt.branch ?? ''} ${repo}`.toLowerCase().includes(needle)
    )
  const at = Math.min(cursor, Math.max(matches.length - 1, 0))

  const pick = (path: string): void => {
    onPick(path)
    dialog.current?.close()
  }
  const onKeyDown = (e: React.KeyboardEvent): void => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key]
    if (step) {
      e.preventDefault()
      setCursor(Math.min(Math.max(at + step, 0), matches.length - 1))
    }
    if (e.key === 'Enter' && matches[at]) pick(matches[at].wt.path)
  }

  return (
    <dialog ref={dialog} className="dialog palette" onClose={onClose}>
      <div className="palette-input">
        <Icon name="search" size={15} />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setCursor(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Search worktrees"
          aria-label="Search worktrees"
        />
      </div>
      <ul className="palette-list" role="listbox" aria-label="Worktrees">
        {matches.map(({ wt, repo }, i) => (
          <li key={wt.path} role="option" aria-selected={i === at}>
            <button onClick={() => pick(wt.path)} onMouseMove={() => setCursor(i)}>
              <span className="card-title">{wt.title ?? wt.branch ?? 'detached'}</span>
              <span className="muted">
                {wt.branch ?? 'detached'} · {repo}
              </span>
            </button>
          </li>
        ))}
        {!matches.length && <li className="muted">No worktree matches.</li>}
      </ul>
    </dialog>
  )
}
