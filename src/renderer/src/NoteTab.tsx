import { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Icon } from './icons'
import { noteSaver, type SaveState } from './noteSaver'

// Typing saves once it pauses this long; leaving the editor or closing the tab saves at once.
const SAVE_DELAY_MS = 300

interface Props {
  name: string
  /** Its tab is showing, so the cursor goes to the editor. */
  active: boolean
}

/** A Markdown note from the notes folder, saved as you type. */
export function NoteTab({ name, active }: Props): React.JSX.Element {
  const [text, setText] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [preview, setPreview] = useState(false)
  const [saver] = useState(() =>
    noteSaver((text) => window.api.writeNote(name, text), setSaveState)
  )
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const editor = useRef<HTMLTextAreaElement>(null)
  const loaded = text !== null

  useEffect(() => {
    if (active && loaded && !preview) editor.current?.focus()
  }, [active, loaded, preview])

  useEffect(() => {
    let current = true
    window.api.readNote(name).then(({ text, error }) => {
      if (!current) return
      if (text === undefined) setLoadError(error ?? 'Could not read the note.')
      else setText(text)
    })
    return () => {
      current = false
    }
  }, [name])

  const flush = useCallback((): void => {
    clearTimeout(timer.current)
    saver.flush()
  }, [saver])

  // Closing the tab unmounts it; closing the window skips unmounting, so pagehide covers that.
  useEffect(() => {
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  const edit = (value: string): void => {
    setText(value)
    saver.edit(value)
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, SAVE_DELAY_MS)
  }

  const status = saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : 'Not saved'

  return (
    <div className="note">
      <header className="preview-head">
        <Icon name="file" size={13} />
        <span className="preview-path">{name}</span>
        {text !== null && (
          <span
            className={typeof saveState === 'object' ? 'note-status failed' : 'note-status'}
            title={typeof saveState === 'object' ? saveState.error : undefined}
          >
            {status}
          </span>
        )}
        <button
          className="secondary"
          onClick={() => setPreview((p) => !p)}
          disabled={text === null}
          aria-pressed={preview}
        >
          {preview ? 'Edit' : 'Preview'}
        </button>
      </header>
      {typeof saveState === 'object' && <p className="error">{saveState.error}</p>}
      {loadError && <p className="error">{loadError}</p>}
      {text === null && !loadError && <p className="muted note-loading">Loading…</p>}
      {text !== null && preview && (
        <div className="preview-body">
          <div className="markdown">
            <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
          </div>
        </div>
      )}
      {text !== null && !preview && (
        <textarea
          ref={editor}
          className="note-editor"
          aria-label={`Note ${name}`}
          value={text}
          onChange={(e) => edit(e.target.value)}
          onBlur={flush}
          placeholder="Write anything. It saves as you type."
          spellCheck={false}
        />
      )}
    </div>
  )
}
