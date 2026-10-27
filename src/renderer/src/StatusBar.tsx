import { useEffect, useState } from 'react'
import type { AwakeMode, ClaudeUsage, Stats } from '../../shared/types'
import { countdown, memory } from './format'
import { Icon } from './icons'
import { useStored } from './useStored'

const STATS_POLL_MS = 10_000
// Anthropic's usage numbers move slowly; Orca asks this often too.
const USAGE_POLL_MS = 15 * 60_000
const CLOCK_MS = 30_000

const AWAKE: Record<AwakeMode, { label: string; title: string; next: AwakeMode }> = {
  off: { label: 'Off', title: 'Keep awake: off. The Mac sleeps as usual.', next: 'auto' },
  auto: { label: 'Auto', title: 'Keep awake while an agent is working', next: 'on' },
  on: { label: 'On', title: 'Keep the Mac awake', next: 'off' }
}

const isAwakeMode = (v: unknown): v is AwakeMode => typeof v === 'string' && v in AWAKE
const basename = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

/** Along the bottom, like Orca's: Claude usage, keep-awake, memory, terminals and ports. */
export function StatusBar({ working }: { working: boolean }): React.JSX.Element {
  const [stats, setStats] = useState<Stats | null>(null)
  const [usage, setUsage] = useState<ClaudeUsage | null>(null)
  const [awake, setAwake] = useStored<AwakeMode>('troy.keepAwake', 'off', isAwakeMode)
  const [now, setNow] = useState(() => Date.now())
  const [portsOpen, setPortsOpen] = useState(false)

  useEffect(() => {
    const poll = (): void => void window.api.stats().then(setStats)
    poll()
    const timer = setInterval(poll, STATS_POLL_MS)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    const poll = (): void => void window.api.usage().then(setUsage)
    poll()
    const timer = setInterval(poll, USAGE_POLL_MS)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => window.api.setAwake(awake, working), [awake, working])

  const left = usage?.resetsAt ? countdown(usage.resetsAt - now) : null
  return (
    <footer className="status-bar">
      {usage && (
        <span className="status-item" title="Claude's 5-hour usage, and when it resets">
          Used {Math.round(usage.percent)}%{left && ` · ${left}`}
        </span>
      )}
      <span className="status-fill" />
      <button
        className="status-item"
        title={AWAKE[awake].title}
        aria-label={`Keep awake: ${AWAKE[awake].label}`}
        onClick={() => setAwake(AWAKE[awake].next)}
      >
        <Icon name="coffee" size={13} />
        {AWAKE[awake].label}
      </button>
      {stats && (
        <>
          <span className="status-item" title="Memory used by Troy and its terminals">
            <Icon name="memory" size={13} />
            {memory(stats.memoryMb)}
          </span>
          <span className="status-item" title="Live terminals">
            <Icon name="terminal" size={13} />
            {stats.terminals}
          </span>
          <span className="status-ports">
            <button
              className="status-item"
              title="Ports listening in your worktrees"
              aria-label={`${stats.ports.length} ports`}
              aria-expanded={portsOpen}
              onClick={() => setPortsOpen((o) => !o)}
            >
              <Icon name="plug" size={13} />
              {stats.ports.length}
            </button>
            {portsOpen && (
              <span className="menu ports-menu" role="menu">
                {stats.ports.length === 0 && <span className="muted">Nothing is listening.</span>}
                {stats.ports.map((p) => (
                  <a
                    key={p.port}
                    href={`http://localhost:${p.port}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>:{p.port}</span>
                    <span className="muted">{basename(p.path)}</span>
                  </a>
                ))}
              </span>
            )}
          </span>
        </>
      )}
    </footer>
  )
}
