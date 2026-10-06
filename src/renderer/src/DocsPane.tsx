import { useEffect, useRef, useState, type ComponentProps } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { resolveDocLink } from './docLinks'

interface Props {
  path: string
  visible: boolean
}

let nextDiagramId = 0

// Mermaid is big, so it loads the first time a diagram shows up.
function Mermaid({ code }: { code: string }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const id = `mermaid-${++nextDiagramId}`
    import('mermaid')
      .then(async ({ default: mermaid }) => {
        // 'strict' sanitizes labels and disables click handlers in the diagram.
        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          securityLevel: 'strict',
          themeVariables: {
            darkMode: true,
            background: '#0d0d16',
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            primaryColor: '#1f1a33',
            primaryBorderColor: '#8b5cf6',
            primaryTextColor: '#e6e6f0',
            lineColor: '#a78bfa',
            secondaryColor: '#2a1830',
            tertiaryColor: '#14141f'
          }
        })
        const { svg } = await mermaid.render(id, code)
        if (alive && host.current) host.current.innerHTML = svg
      })
      .catch((err) => alive && setError(`Diagram error: ${(err as Error).message}`))
    return () => {
      alive = false
    }
  }, [code])

  return error ? <pre className="error">{error}</pre> : <div ref={host} className="mermaid" />
}

const isReadme = (f: string): boolean => /(^|\/)readme\.md$/i.test(f)

export function DocsPane({ path, visible }: Props): React.JSX.Element {
  const [files, setFiles] = useState<string[] | null>(null)
  const [file, setFile] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    window.api.docs(path).then((result) => {
      if (result.error) return setError(result.error)
      const list = result.files ?? []
      setFiles(list)
      setFile((f) => (f && list.includes(f) ? f : (list.find(isReadme) ?? list[0] ?? null)))
    })
  }, [visible, path])

  useEffect(() => {
    if (!visible || !file) return
    let current = true
    window.api.readDoc(path, file).then((result) => {
      if (!current) return
      setError(result.error ?? null)
      setText(result.text ?? null)
    })
    return () => {
      current = false
    }
  }, [visible, path, file])

  const link = ({ href = '', children }: ComponentProps<'a'>): React.JSX.Element => {
    const target = file ? resolveDocLink(file, href) : null
    if (target !== null && files?.includes(target))
      return (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault()
            setFile(target)
          }}
        >
          {children}
        </a>
      )
    // Opens in the browser through the main process's window-open handler.
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  }

  const code = ({ className, children }: ComponentProps<'code'>): React.JSX.Element =>
    className === 'language-mermaid' ? (
      <Mermaid code={String(children).trimEnd()} />
    ) : (
      <code className={className}>{children}</code>
    )

  return (
    <div className="docs-pane">
      {files && files.length > 0 && (
        <select
          value={file ?? ''}
          onChange={(e) => setFile(e.target.value)}
          aria-label="Markdown file"
        >
          {files.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      )}
      {error && <p className="error">{error}</p>}
      {files?.length === 0 && <p className="muted">No markdown files in this worktree.</p>}
      {text !== null && (
        <article className="markdown">
          <Markdown remarkPlugins={[remarkGfm]} components={{ a: link, code }}>
            {text}
          </Markdown>
        </article>
      )}
    </div>
  )
}
