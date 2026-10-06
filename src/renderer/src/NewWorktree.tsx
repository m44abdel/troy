import { useEffect, useRef, useState, type FormEvent } from 'react'
import { KNOWN_AGENTS } from '../../shared/shell'
import type { CreateRequest } from '../../shared/types'
import { Icon } from './icons'

export type NewWorktreeRequest = Required<CreateRequest>

interface Props {
  repoName: string
  /** Agents found on PATH; the first is the default. */
  installed: string[]
  onCancel: () => void
  /** Resolves to an error message, or null once the worktree exists. */
  onCreate: (req: NewWorktreeRequest) => Promise<string | null>
}

export function NewWorktree({ repoName, installed, onCancel, onCreate }: Props): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => dialog.current?.showModal(), [])
  const agents = [...installed, ...KNOWN_AGENTS.filter((a) => !installed.includes(a))]

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const field = (name: string): string => String(form.get(name) ?? '').trim()
    setBusy(true)
    setError(
      await onCreate({
        branch: field('branch'),
        base: field('base'),
        agent: field('agent'),
        prompt: field('prompt')
      })
    )
    setBusy(false)
  }

  return (
    <dialog ref={dialog} className="dialog" onClose={onCancel}>
      <form onSubmit={submit}>
        <div className="dialog-head">
          <span className="dialog-icon">
            <Icon name="branch" size={18} />
          </span>
          <div>
            <h2>New worktree in {repoName}</h2>
            <p className="muted">A fresh branch and checkout, with its own agent and shell.</p>
          </div>
        </div>
        <label>
          Branch
          <input name="branch" required autoFocus placeholder="feat/login" />
        </label>
        <label>
          Base branch
          <input name="base" placeholder="default branch" />
        </label>
        <label>
          Agent
          <input name="agent" required list="agents" defaultValue={agents[0]} />
          <datalist id="agents">
            {agents.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        <label>
          Initial prompt
          <textarea name="prompt" rows={3} placeholder="optional" />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" className="secondary" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? (
              <span className="spinner" aria-hidden="true" />
            ) : (
              <Icon name="plus" size={14} />
            )}
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
