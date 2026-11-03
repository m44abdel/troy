import { useEffect, useEffectEvent, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { shellQuote } from '../../shared/shell'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { trackStatus, type StatusListener } from '../../shared/status'
import { terminals } from './terminals'

// Each refit resizes the pty, and the agent's TUI redraws its whole screen; a drag would set
// that off every frame, so the terminal refits once the size holds still this long.
const FIT_DELAY_MS = 100

// The background matches --surface in main.css.
const THEME = {
  background: '#0f0f0f',
  foreground: '#e6e6e6',
  cursor: '#d6d6d6',
  cursorAccent: '#0f0f0f',
  selectionBackground: '#ffffff33',
  black: '#1e1e1e',
  red: '#e5645c',
  green: '#4fb286',
  yellow: '#e0a43a',
  blue: '#6b9ae0',
  magenta: '#c27bc9',
  cyan: '#4fb5b8',
  white: '#d4d4d4',
  brightBlack: '#666666',
  brightRed: '#f08a83',
  brightGreen: '#78c9a3',
  brightYellow: '#ecc06a',
  brightBlue: '#92b6ea',
  brightMagenta: '#d9a0dd',
  brightCyan: '#7fcfd1',
  brightWhite: '#ffffff'
}

export interface TerminalProps {
  id: string
  cwd: string
  port?: number
  /** Agent CLI. The pane waits for Enter, then the shell execs it. */
  command?: string
  /** Passed to the agent on its first launch only. */
  prompt?: string
  /** Appended to the agent command on every launch, after the prompt. */
  args?: string
  /** Continues the last conversation; used on a launch that has no new prompt to send. */
  resume?: string
  /** Typed into a plain shell on its first launch only. */
  initialInput?: string
  /** Launches the agent right away instead of waiting for Enter. */
  autoStart?: boolean
  onStatus?: StatusListener
}

export function Terminal({
  id,
  cwd,
  port,
  command,
  prompt,
  args = '',
  resume = '',
  initialInput,
  autoStart = false,
  onStatus
}: TerminalProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  // Read at launch only; the repo list refreshes it while agents run.
  const resumeRef = useRef(resume)
  useEffect(() => {
    resumeRef.current = resume
  })
  const reportStatus = useEffectEvent<StatusListener>((status, certain) =>
    onStatus?.(status, certain)
  )

  useEffect(() => {
    const xterm = new XTerm({
      fontFamily: '"SF Mono", Menlo, Monaco, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      // Option sends Meta so Alt-f / Alt-b word movement works in shells and agents.
      macOptionIsMeta: true,
      theme: THEME,
      // The unicode API is still "proposed" in xterm 6.
      allowProposedApi: true
    })
    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    // Agents' TUIs measure emoji as two columns wide; xterm's default (Unicode 6) says one,
    // which shifts their cursor moves and scrambles the screen as they redraw.
    xterm.loadAddon(new Unicode11Addon())
    xterm.unicode.activeVersion = '11'
    xterm.open(host.current!)
    fitAddon.fit()
    terminals.set(id, xterm)

    const env = port ? { PORT_BASE: String(port) } : undefined
    const tracker = command ? trackStatus(reportStatus) : null
    let ptyId: string | null = null
    let starting = false
    // Keys typed while the shell starts, e.g. right after a split; sent once it is up.
    let typedEarly = ''
    let launches = 0
    let disposed = false
    let unsubscribe: Array<() => void> = []

    const start = (): void => {
      const firstRun = launches++ === 0
      // A new task starts with its prompt; otherwise pick up the last conversation.
      const opening = firstRun && prompt ? ` ${shellQuote(prompt)}` : resumeRef.current
      const input = command
        ? `exec ${command}${opening}${args}\r`
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
            window.api.onPtyStatus(pid, (status) => tracker?.hook(status)),
            window.api.onPtyExit(pid, (code) => {
              ptyId = null
              unsubscribe.forEach((fn) => fn())
              tracker?.exit(code)
              xterm.write(`\r\n[exited with code ${code}] Press Enter to restart.\r\n`)
            })
          ]
          if (input) window.api.ptyWrite(pid, input)
          if (typedEarly) window.api.ptyWrite(pid, typedEarly)
          typedEarly = ''
        })
        .catch((err) => xterm.write(`Could not start a shell: ${err.message}\r\n`))
        .finally(() => (starting = false))
    }

    const verb = resumeRef.current && !prompt ? 'resume' : 'start'
    if (command && !autoStart) xterm.write(`Press Enter to ${verb} \x1b[1m${command}\x1b[0m\r\n`)
    else start()

    const input = xterm.onData((data) => {
      if (ptyId) window.api.ptyWrite(ptyId, data)
      else if (starting) typedEarly += data
      else if (data === '\r') start()
    })
    const bell = xterm.onBell(() => tracker?.bell())
    const resize = xterm.onResize(({ cols, rows }) => {
      if (!ptyId) return
      tracker?.resize()
      window.api.ptyResize(ptyId, cols, rows)
    })

    let fitTimer: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => {
      clearTimeout(fitTimer)
      fitTimer = setTimeout(() => {
        if (host.current?.offsetParent) fitAddon.fit()
      }, FIT_DELAY_MS)
    })
    observer.observe(host.current!)

    return () => {
      disposed = true
      clearTimeout(fitTimer)
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
  }, [id, cwd, port, command, prompt, args, initialInput, autoStart])

  return <div ref={host} className="terminal" />
}
