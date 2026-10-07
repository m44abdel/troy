import { useState } from 'react'
import type { Knowledge, KnowledgeEntry } from '../../shared/types'

interface Props {
  path: string
  knowledge?: Knowledge | { error: string }
  onChanged: () => void
  /** Has the agent propose what it learned; resolves to a note for the person. */
  onHarvest: () => Promise<{ notice?: string; error?: string }>
}

function Meta({ entry }: { entry: KnowledgeEntry }): React.JSX.Element {
  return (
    <p className="fact-meta">
      <code>{entry.source}</code> · {entry.date} · {entry.author}
    </p>
  )
}

export function KnowledgePane({ path, knowledge, onChanged, onHarvest }: Props): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!knowledge) return <div className="knowledge-pane muted">Loading…</div>
  if ('error' in knowledge)
    return (
      <div className="knowledge-pane">
        <p className="error">{knowledge.error}</p>
      </div>
    )

  const act = async (run: () => Promise<{ error?: string }>): Promise<void> => {
    setBusy(true)
    const result = await run()
    setBusy(false)
    setError(result.error ?? null)
    onChanged()
  }

  const harvest = async (): Promise<void> => {
    setBusy(true)
    setNotice('Asking the agent what it learned…')
    const result = await onHarvest()
    setBusy(false)
    setNotice(result.notice ?? null)
    setError(result.error ?? null)
    onChanged()
  }

  return (
    <div className="knowledge-pane">
      <div className="harvest-bar">
        <button className="secondary" disabled={busy} onClick={harvest}>
          Propose facts from this session
        </button>
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {knowledge.proposals.length > 0 && (
        <section>
          <h3>
            Review queue <span className="count">{knowledge.proposals.length}</span>
          </h3>
          {knowledge.proposals.map((p) => (
            <article key={p.id} className="fact proposal">
              <p>{p.fact}</p>
              <Meta entry={p} />
              <div className="actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => act(() => window.api.rejectFact(path, p.id))}
                >
                  Reject
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => act(() => window.api.approveFact(path, p.id))}
                >
                  Approve
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
      <section>
        <h3>Approved</h3>
        {knowledge.entries.length === 0 && (
          <p className="muted empty-note">
            Nothing yet. Agents propose facts with the <code>knowledge_propose</code> tool of the
            troy MCP server; approved ones go to <code>.troy/knowledge.md</code> in the main
            checkout, ready to commit.
          </p>
        )}
        {knowledge.entries.map((e, i) => (
          <article key={i} className="fact">
            <p>
              {e.fact}
              {e.stale && (
                <span className="badge" title={`${e.source} changed after ${e.date}`}>
                  stale
                </span>
              )}
            </p>
            <Meta entry={e} />
          </article>
        ))}
      </section>
    </div>
  )
}
