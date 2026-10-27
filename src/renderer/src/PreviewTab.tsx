import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Preview } from '../../shared/types'
import { Icon } from './icons'

const MARKDOWN = /\.(md|markdown|mdx)$/i

interface Props {
  path: string
  file: string
  /** Scrolls to and marks this line, e.g. a search hit. */
  line?: number
  visible: boolean
}

function Body({
  file,
  preview,
  line
}: {
  file: string
  preview: Preview
  line?: number
}): React.JSX.Element {
  if (preview.binary) return <p className="muted">Binary file. Open it in your editor.</p>
  if (preview.tooLarge)
    return <p className="muted">Too large to preview. Open it in your editor.</p>
  const text = preview.text ?? ''
  if (MARKDOWN.test(file))
    return (
      <div className="markdown">
        <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
      </div>
    )
  return (
    <pre className="preview-code">
      {text.split('\n').map((content, i) => (
        <div key={i} data-line={i + 1} className={i + 1 === line ? 'hit' : undefined}>
          <span className="ln">{i + 1}</span>
          {content || ' '}
        </div>
      ))}
    </pre>
  )
}

/** A read-only view of one file in the worktree, opened from the Files tab. */
export function PreviewTab({ path, file, line, visible }: Props): React.JSX.Element {
  const [preview, setPreview] = useState<(Preview & { error?: string }) | null>(null)
  const [reloads, setReloads] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!visible) return
    let current = true
    window.api.readFile(path, file).then((p) => current && setPreview(p))
    return () => {
      current = false
    }
  }, [path, file, visible, reloads])

  useEffect(() => {
    if (line && preview?.text !== undefined)
      body.current?.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ block: 'center' })
  }, [line, preview])

  const openInEditor = async (): Promise<void> => {
    const result = await window.api.openFile(path, file)
    setError(result.error ?? null)
  }

  return (
    <div className="preview">
      <header className="preview-head">
        <Icon name="file" size={13} />
        <span className="preview-path">{file}</span>
        <button
          className="icon-button"
          aria-label="Reload"
          onClick={() => setReloads((n) => n + 1)}
        >
          <Icon name="refresh" size={14} />
        </button>
        <button className="secondary" onClick={openInEditor}>
          <Icon name="external" size={13} />
          Open in editor
        </button>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="preview-body" ref={body}>
        {!preview && <p className="muted">Loading…</p>}
        {preview?.error && <p className="error">{preview.error}</p>}
        {preview && !preview.error && <Body file={file} preview={preview} line={line} />}
      </div>
    </div>
  )
}
