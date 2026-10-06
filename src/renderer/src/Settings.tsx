import { useEffect, useRef, useState } from 'react'
import { KNOWN_AGENTS } from '../../shared/shell'
import type { Settings as SettingsData } from '../../shared/types'
import { Icon } from './icons'

interface Props {
  settings: SettingsData
  installed: string[]
  onChange: (next: Partial<SettingsData>) => void
  onClose: () => void
}

export function Settings({ settings, installed, onChange, onClose }: Props): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => dialog.current?.showModal(), [])

  const openKeybindings = async (): Promise<void> =>
    // openPath resolves to an error message, or '' once the file is open.
    setError((await window.api.openKeybindings()) || null)

  return (
    <dialog ref={dialog} className="dialog settings" onClose={onClose}>
      <div className="dialog-head">
        <span className="dialog-icon">
          <Icon name="settings" size={18} />
        </span>
        <div>
          <h2>Settings</h2>
          <p className="muted">Saved as you change them.</p>
        </div>
      </div>

      <label className="check">
        <input
          type="checkbox"
          className="switch"
          checked={settings.vim}
          onChange={(e) => onChange({ vim: e.target.checked })}
        />
        <span>
          Vim navigation
          <small>
            j/k, gg/G and Enter in the sidebar; j/k, gg/G and ]c/[c in the diff. Never inside a
            terminal.
          </small>
        </span>
      </label>

      <section>
        <h3>Keyboard shortcuts</h3>
        <p className="muted">
          Map key codes to actions in keybindings.json. Set a key to <code>null</code> to hand it to
          the terminal instead. Changes apply as soon as you save.
        </p>
        <button className="secondary" onClick={openKeybindings}>
          <Icon name="keyboard" size={14} />
          Open keybindings.json
        </button>
        {error && <p className="error">{error}</p>}
      </section>

      <section>
        <h3>Agents on your PATH</h3>
        <ul className="agents">
          {KNOWN_AGENTS.map((agent) => (
            <li key={agent} className={installed.includes(agent) ? 'found' : 'missing'}>
              {installed.includes(agent) && <Icon name="check" size={12} />}
              {agent}
            </li>
          ))}
        </ul>
      </section>

      <div className="actions">
        <button className="primary" onClick={() => dialog.current?.close()}>
          Done
        </button>
      </div>
    </dialog>
  )
}
