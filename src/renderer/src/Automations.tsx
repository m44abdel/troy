import { useEffect, useRef, useState, type FormEvent } from 'react'
import { parseAutomation } from '../../shared/automation'
import { KNOWN_AGENTS } from '../../shared/shell'
import type { Automation } from '../../shared/types'
import { Icon } from './icons'

interface Props {
  repos: string[]
  installed: string[]
  onClose: () => void
}

const basename = (path: string): string => path.split('/').pop() ?? path

/** Scheduled prompts, each run in a fresh worktree. Saved as you add or remove them. */
export function Automations({ repos, installed, onClose }: Props): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const [list, setList] = useState<Automation[]>([])
  const [error, setError] = useState<string | null>(null)
  const agents = [...installed, ...KNOWN_AGENTS.filter((a) => !installed.includes(a))]

  useEffect(() => {
    dialog.current?.showModal()
    window.api.getAutomations().then(setList)
  }, [])

  const save = async (next: Automation[]): Promise<boolean> => {
    try {
      setList(await window.api.setAutomations(next))
      setError(null)
      return true
    } catch (err) {
      setError(`Could not save: ${(err as Error).message}`)
      return false
    }
  }

  const add = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const form = event.currentTarget
    const data = Object.fromEntries(new FormData(form))
    let automation: Automation
    try {
      automation = parseAutomation({ ...data, id: crypto.randomUUID() })
    } catch (err) {
      return setError((err as Error).message)
    }
    if (await save([...list, automation])) form.reset()
  }

  return (
    <dialog ref={dialog} className="dialog automations" onClose={onClose}>
      <div className="dialog-head">
        <span className="dialog-icon">
          <Icon name="refresh" size={18} />
        </span>
        <div>
          <h2>Automations</h2>
          <p className="muted">
            Each run starts the agent in a new worktree. They run while Troy is open.
          </p>
        </div>
      </div>

      {list.length > 0 && (
        <ul className="automation-list">
          {list.map((a) => (
            <li key={a.id}>
              <span>
                <strong>{a.name}</strong>
                <small>
                  <code>{a.schedule}</code> · {basename(a.repo)} · {a.agent}
                </small>
              </span>
              <button
                className="icon-button"
                aria-label={`Delete ${a.name}`}
                onClick={() => save(list.filter((x) => x.id !== a.id))}
              >
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add}>
        <label>
          Name
          <input name="name" required placeholder="Check the deploy" />
        </label>
        <label>
          Repository
          <select name="repo" required>
            {repos.map((r) => (
              <option key={r} value={r}>
                {basename(r)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Schedule
          <input name="schedule" required defaultValue="0 9 * * 1-5" />
          <small className="muted">minute hour day month weekday, local time</small>
        </label>
        <label>
          Agent
          <input name="agent" required list="automation-agents" defaultValue={agents[0]} />
          <datalist id="automation-agents">
            {agents.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        <label>
          Prompt
          <textarea name="prompt" rows={3} required />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" className="secondary" onClick={() => dialog.current?.close()}>
            Done
          </button>
          <button className="primary">
            <Icon name="plus" size={14} />
            Add
          </button>
        </div>
      </form>
    </dialog>
  )
}
