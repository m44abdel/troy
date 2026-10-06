import { useEffect, useEffectEvent, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { shellQuote } from '../../shared/shell'
import { trackStatus, type AgentStatus } from '../../shared/status'
import { terminals } from './terminals'

// Matches the --surface and status tokens in main.css.
const THEME = {
  background: '#0d0d16',
  foreground: '#e6e6f0',
  cursor: '#f472b6',
  cursorAccent: '#0d0d16',
  selectionBackground: '#8b5cf640',
  black: '#1c1c2b',
  red: '#fb7185',
  green: '#34d399',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#38bdf8',
  white: '#d4d4e2',
  brightBlack: '#5c5c78',
  brightRed: '#fda4af',
  brightGreen: '#6ee7b7',
  brightYellow: '#fcd34d',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#7dd3fc',
  brightWhite: '#ffffff'
}

interface Props {
  id: string
  cwd: string
  port?: number
  /** Agent CLI. The pane waits for Enter, then the shell execs it. */
  command?: string
  /** Passed to the agent on its first launch only. */
  prompt?: string
  /** Appended to the agent command on every launch, after the prompt. */
  args?: string
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
  args = '',
  initialInput,
  onStatus
}: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const reportStatus = useEffectEvent((status: AgentStatus) => onStatus?.(status))

  useEffect(() => {
    const xterm = new XTerm({
      fontFamily: '"SF Mono", Menlo, Monaco, monospace',
      fontSize: 13,
      lineHeight: 1.2,
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
        ? `exec ${command}${firstRun && prompt ? ` ${shellQuote(prompt)}` : ''}${args}\r`
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
    const resize = xterm.onResize(({ cols, rows }) => {
      if (!ptyId) return
      tracker?.resize()
      window.api.ptyResize(ptyId, cols, rows)
    })

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
  }, [id, cwd, port, command, prompt, args, initialInput])

  return <div ref={host} className="terminal" />
}
