import { useCallback, useEffect, useState } from 'react'
import type { AppAction } from '../../shared/keys'
import { Terminal } from './Terminal'

const isMac = navigator.userAgent.includes('Mac')
const MOD = isMac ? '⌘' : 'Ctrl+Shift+'

const basename = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

function App(): React.JSX.Element {
  const [repos, setRepos] = useState<string[]>([])
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.listRepos().then(setRepos)
  }, [])

  const addRepo = useCallback(async () => {
    const result = await window.api.addRepo()
    setRepos(result.repos)
    setError(result.error ?? null)
    if (result.added) setSelected(result.repos.indexOf(result.added))
  }, [])

  useEffect(
    () =>
      window.api.onAction((action: AppAction) => {
        if (action === 'addRepo') return void addRepo()
        if (repos.length === 0) return
        if (action === 'prev') return setSelected((i) => (i - 1 + repos.length) % repos.length)
        if (action === 'next') return setSelected((i) => (i + 1) % repos.length)
        const index = Number(action.split(':')[1]) - 1
        if (index < repos.length) setSelected(index)
      }),
    [repos, addRepo]
  )

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="brand">Troy</span>
          <button className="icon-button" onClick={addRepo} title={`Add repository (${MOD}O)`}>
            +
          </button>
        </div>
        <nav className="repo-list">
          {repos.map((repo, i) => (
            <button
              key={repo}
              className={`repo ${i === selected ? 'selected' : ''}`}
              onClick={() => setSelected(i)}
              title={repo}
            >
              <span className="repo-name">{basename(repo)}</span>
              {i < 9 && <kbd>{`${MOD}${i + 1}`}</kbd>}
            </button>
          ))}
        </nav>
        {error && <p className="error">{error}</p>}
      </aside>

      <main className="workspace">
        {repos.length === 0 ? (
          <div className="empty">
            <h1>Welcome to Troy</h1>
            <p>Add a git repository to get started.</p>
            <button className="primary" onClick={addRepo}>
              Add repository <kbd>{MOD}O</kbd>
            </button>
          </div>
        ) : (
          repos.map((repo, i) => <Terminal key={repo} cwd={repo} active={i === selected} />)
        )}
      </main>
    </div>
  )
}

export default App
