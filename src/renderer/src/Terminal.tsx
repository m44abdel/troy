import { useEffect, useEffectEvent, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { trackStatus, type AgentStatus } from '../../shared/status'
import { terminals } from './terminals'

const THEME = {
  background: '#0f1115',
  foreground: '#d6dae1',
  cursor: '#8ab4ff',
  selectionBackground: '#2a3a55'
}

// ponytail: POSIX quoting; Windows shells need their own once Windows is supported.
const shellQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`

interface Props {
  id: string
  cwd: string
  port?: number
  /** Agent CLI. The pane waits for Enter, then the shell execs it. */
  command?: string
  /** Passed to the agent on its first launch only. */
  prompt?: string
  /** Typed into a plain shell on its first launch only. */
  initialInput?: string
  onStatus?: (status: AgentStatus) => void
}

export function Terminal({
  id,
  cwd,
  port,
  command,
  prompt,
  initialInput,
  onStatus
}: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const reportStatus = useEffectEvent((status: AgentStatus) => onStatus?.(status))

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
    terminals.set(id, xterm)

    const env = port ? { PORT_BASE: String(port) } : undefined
    const tracker = command ? trackStatus(reportStatus) : null
    let ptyId: string | null = null
    let starting = false
    let launches = 0
    let disposed = false
    let unsubscribe: Array<() => void> = []

    const start = (): void => {
      const firstRun = launches++ === 0
      const input = command
        ? `exec ${command}${firstRun && prompt ? ` ${shellQuote(prompt)}` : ''}\r`
        : firstRun
          ? initialInput
          : undefined
      starting = true
      window.api
        .ptySpawn(cwd, xterm.cols, xterm.rows, env)
        .then((pid) => {
          if (disposed) return window.api.ptyKill(pid)
          ptyId = pid
          unsubscribe = [
            window.api.onPtyData(pid, (data) => {
              xterm.write(data)
              tracker?.output()
            }),
            window.api.onPtyExit(pid, (code) => {
              ptyId = null
              unsubscribe.forEach((fn) => fn())
              tracker?.exit(code)
              xterm.write(`\r\n[exited with code ${code}] Press Enter to restart.\r\n`)
            })
          ]
          if (input) window.api.ptyWrite(pid, input)
        })
        .catch((err) => xterm.write(`Could not start a shell: ${err.message}\r\n`))
        .finally(() => (starting = false))
    }

    if (command) xterm.write(`Press Enter to start \x1b[1m${command}\x1b[0m\r\n`)
    else start()

    const input = xterm.onData((data) => {
      if (ptyId) window.api.ptyWrite(ptyId, data)
      else if (data === '\r' && !starting) start()
    })
    const bell = xterm.onBell(() => tracker?.bell())
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
      bell.dispose()
      resize.dispose()
      tracker?.dispose()
      unsubscribe.forEach((fn) => fn())
      if (ptyId) window.api.ptyKill(ptyId)
      terminals.delete(id)
      xterm.dispose()
    }
  }, [id, cwd, port, command, prompt, initialInput])

  return <div ref={host} className="terminal" />
}
