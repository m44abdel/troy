import { Fragment, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { buildTree, type TreeNode } from '../../shared/tree'
import type { FileList, GrepHit } from '../../shared/types'
import { Icon } from './icons'
import { MOD } from './platform'
import { requestTab } from './terminals'

const SEARCH_DELAY_MS = 300
const MAX_NAME_MATCHES = 500

type Mode = 'names' | 'contents'

interface Props {
  path: string
  visible: boolean
  /** Changes whenever the files may have changed, e.g. the agent's status moved. */
  refreshKey: string
  /** Bumped by Cmd-Shift-F: search file contents. */
  searchNonce: number
}

interface RowsProps {
  nodes: TreeNode[]
  depth: number
  open: string[]
  onToggle: (dir: string) => void
  onOpen: (file: string) => void
}

function Rows({ nodes, depth, open, onToggle, onOpen }: RowsProps): React.JSX.Element {
  return (
    <>
      {nodes.map((n) => {
        // An ignored folder's contents aren't listed, so it doesn't open.
        const opens = n.dir && !n.ignored
        const expanded = open.includes(n.path)
        return (
          <Fragment key={n.path}>
            <button
              className={`tree-row ${n.ignored ? 'ignored' : ''}`}
              style={{ paddingLeft: 8 + depth * 12 }}
              aria-expanded={opens ? expanded : undefined}
              title={n.ignored ? 'Ignored by .gitignore' : n.path}
              onClick={() => (n.dir ? opens && onToggle(n.path) : onOpen(n.path))}
            >
              <span className="tree-chevron">{opens && <Icon name="chevron" size={12} />}</span>
              <Icon name={n.dir ? 'folder' : 'file'} size={13} />
              <span className="tree-name">{n.name}</span>
              {n.ignored && <Icon name="circleSlash" size={12} />}
            </button>
            {opens && expanded && (
              <Rows {...{ open, onToggle, onOpen }} nodes={n.children} depth={depth + 1} />
            )}
          </Fragment>
        )
      })}
    </>
  )
}

function Hits({
  hits,
  onOpen
}: {
  hits: GrepHit[]
  onOpen: (f: string, line: number) => void
}): React.JSX.Element {
  const byFile = Map.groupBy(hits, (h) => h.file)
  if (!hits.length) return <p className="muted">No matches.</p>
  return (
    <>
      {[...byFile].map(([file, lines]) => (
        <section key={file} className="hit-file">
          <h4 title={file}>{file}</h4>
          {lines.map((h) => (
            <button key={h.line} className="hit-row" onClick={() => onOpen(file, h.line)}>
              <span className="ln">{h.line}</span>
              <span className="hit-text">{h.text.trim()}</span>
            </button>
          ))}
        </section>
      ))}
    </>
  )
}

/** The worktree's files as a tree, filtered by name or searched by content. */
export function FilesPane({ path, visible, refreshKey, searchNonce }: Props): React.JSX.Element {
  const [list, setList] = useState<FileList | { error: string } | null>(null)
  const [reloads, setReloads] = useState(0)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<Mode>('names')
  const [open, setOpen] = useState<string[]>([])
  const [found, setFound] = useState<{ query: string; hits: GrepHit[]; error?: string }>()
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!visible) return
    let current = true
    window.api.files(path).then((l) => current && setList(l))
    return () => {
      current = false
    }
  }, [path, visible, refreshKey, reloads])

  // Cmd-Shift-F switches the visible pane to a content search and puts the cursor in it.
  const [searched, setSearched] = useState(searchNonce)
  if (searched !== searchNonce) {
    setSearched(searchNonce)
    if (visible) setMode('contents')
  }
  const focusSearch = useEffectEvent(() => visible && input.current?.focus())
  useEffect(() => {
    if (searchNonce) focusSearch()
  }, [searchNonce])

  useEffect(() => {
    if (mode !== 'contents' || !query.trim()) return
    const timer = setTimeout(
      () =>
        window.api
          .grep(path, query)
          .then((r) => setFound({ query, hits: r.hits ?? [], error: r.error })),
      SEARCH_DELAY_MS
    )
    return () => clearTimeout(timer)
  }, [mode, query, path])

  const tree = useMemo(
    () => (list && 'files' in list ? buildTree(list.files, list.ignored) : []),
    [list]
  )
  const show = (file: string, line?: number): void =>
    requestTab(path, { kind: 'preview', file, line })
  const toggle = (dir: string): void =>
    setOpen((o) => (o.includes(dir) ? o.filter((d) => d !== dir) : [...o, dir]))

  const needle = query.trim().toLowerCase()
  const names =
    list && 'files' in list && needle
      ? list.files.filter((f) => f.toLowerCase().includes(needle)).slice(0, MAX_NAME_MATCHES)
      : []
  const hits = found?.query === query ? found : undefined

  return (
    <div className="files-pane">
      <header className="files-head">
        <span>{path.split('/').pop()}</span>
        <button
          className="icon-button"
          aria-label="Refresh"
          onClick={() => setReloads((n) => n + 1)}
        >
          <Icon name="refresh" size={14} />
        </button>
      </header>
      <div className="files-search">
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={mode === 'names' ? 'Find files' : `Search in files (${MOD}⇧F)`}
          aria-label={mode === 'names' ? 'Find files' : 'Search in files'}
        />
        <div className="segmented" role="radiogroup" aria-label="Search by">
          {(['names', 'contents'] as Mode[]).map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}>
              {m === 'names' ? 'Names' : 'Contents'}
            </button>
          ))}
        </div>
      </div>
      <div className="files-body">
        {list && 'error' in list && <p className="error">{list.error}</p>}
        {!needle && <Rows nodes={tree} depth={0} open={open} onToggle={toggle} onOpen={show} />}
        {needle &&
          mode === 'names' &&
          names.map((f) => (
            <button key={f} className="tree-row" onClick={() => show(f)} title={f}>
              <Icon name="file" size={13} />
              <span className="tree-name">{f.split('/').pop()}</span>
              <span className="change-dir">{f.split('/').slice(0, -1).join('/')}</span>
            </button>
          ))}
        {needle && mode === 'contents' && hits?.error && <p className="error">{hits.error}</p>}
        {needle && mode === 'contents' && hits && <Hits hits={hits.hits} onOpen={show} />}
      </div>
    </div>
  )
}
