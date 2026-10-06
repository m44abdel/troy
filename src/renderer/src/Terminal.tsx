import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const THEME = {
  background: '#0f1115',
  foreground: '#d6dae1',
  cursor: '#8ab4ff',
  selectionBackground: '#2a3a55'
}

export function Terminal({ cwd, active }: { cwd: string; active: boolean }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<XTerm | null>(null)
  const fit = useRef<FitAddon | null>(null)

  useEffect(() => {
    const xterm = new XTerm({
      fontFamily: 'Menlo, "SF Mono", Monaco, monospace',
      fontSize: 13,
      cursorBlink: true,
      // Option sends Meta so Alt-f / Alt-b word movement works in shells and agents.
      macOptionIsMeta: true,
      theme: THEME
    })
    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    xterm.open(host.current!)
    fitAddon.fit()
    term.current = xterm
    fit.current = fitAddon

    let ptyId: string | null = null
    let disposed = false
    const cleanups: Array<() => void> = []

    window.api
      .ptySpawn(cwd, xterm.cols, xterm.rows)
      .then((id) => {
        if (disposed) return window.api.ptyKill(id)
        ptyId = id
        cleanups.push(window.api.onPtyData(id, (data) => xterm.write(data)))
        cleanups.push(
          window.api.onPtyExit(id, (code) =>
            xterm.write(`\r\n[process exited with code ${code}]\r\n`)
          )
        )
      })
      .catch((err) => xterm.write(`Could not start a shell: ${err.message}\r\n`))

    const input = xterm.onData((data) => ptyId && window.api.ptyWrite(ptyId, data))
    const resize = xterm.onResize(
      ({ cols, rows }) => ptyId && window.api.ptyResize(ptyId, cols, rows)
    )

    const observer = new ResizeObserver(() => {
      if (host.current?.offsetParent) fitAddon.fit()
    })
    observer.observe(host.current!)

    return () => {
      disposed = true
      observer.disconnect()
      input.dispose()
      resize.dispose()
      cleanups.forEach((fn) => fn())
      if (ptyId) window.api.ptyKill(ptyId)
      xterm.dispose()
    }
  }, [cwd])

  useEffect(() => {
    if (!active) return
    fit.current?.fit()
    term.current?.focus()
  }, [active])

  return <div ref={host} className="terminal" style={{ display: active ? 'block' : 'none' }} />
}
