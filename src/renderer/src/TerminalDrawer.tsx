import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { AppAction } from '../../shared/keys'
import { Icon } from './icons'
import { MOD } from './platform'
import { Splitter } from './Splitter'
import { Terminal } from './Terminal'
import { focusTerminal } from './terminals'
import { DRAWER_HEIGHT } from './useDrawer'

interface Props {
  id: string
  cwd: string
  port?: number
  open: boolean
  /** Whether this drawer's column is on screen, so the tab shortcuts are its own. */
  visible: boolean
  onToggle: () => void
  height: number
  onHeight: (height: number) => void
}

/** Shells at the bottom of a column, one per tab. Its bar always shows; shells start on first open. */
export function TerminalDrawer({
  id,
  cwd,
  port,
  open,
  visible,
  onToggle,
  height,
  onHeight
}: Props): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  // Once started the shells stay alive while folded or hidden, so a dev server keeps running.
  const [started, setStarted] = useState(open)
  if (open && !started) setStarted(true)
  // The first tab keeps the drawer's own id; closing a tab unmounts its Terminal, which kills the shell.
  const [tabs, setTabs] = useState([id])
  const [active, setActive] = useState(id)
  const nextTab = useRef(2)

  // Focus waits for an effect: by then the tab's Terminal has mounted and can take it.
  const pendingFocus = useRef<string | null>(null)
  const wasOpen = useRef(open)
  useEffect(() => {
    const opened = open && !wasOpen.current
    wasOpen.current = open
    const target = pendingFocus.current ?? (opened && visible ? active : null)
    pendingFocus.current = null
    if (target) focusTerminal(target)
  })

  const show = (tab: string): void => {
    setActive(tab)
    pendingFocus.current = tab
  }
  const addTab = (): void => {
    const tab = `${id}:${nextTab.current++}`
    setTabs((t) => [...t, tab])
    show(tab)
  }
  const closeTab = (tab: string): void => {
    const i = tabs.indexOf(tab)
    const rest = tabs.filter((t) => t !== tab)
    setTabs(rest)
    if (tab === active) show(rest[Math.min(i, rest.length - 1)])
  }

  // Steps through the tabs and wraps at either end, like Chrome's Cmd-Shift-[ and ].
  const cycle = (by: number): void =>
    show(tabs[(tabs.indexOf(active) + by + tabs.length) % tabs.length])

  const onAction = useEffectEvent((action: AppAction) => {
    if (action === 'newTerminal') {
      if (!open) onToggle()
      // A drawer opened for the first time starts with a fresh shell already.
      return started ? addTab() : undefined
    }
    if (!open) return
    // The last tab can't close (the drawer always has a shell), so it folds the drawer instead.
    if (action === 'closeTerminal') return tabs.length > 1 ? closeTab(active) : onToggle()
    if (action === 'prevTerminal') cycle(-1)
    if (action === 'nextTerminal') cycle(1)
  })
  useEffect(() => (visible ? window.api.onAction(onAction) : undefined), [visible])

  return (
    <div className="drawer" ref={root}>
      {open && (
        <Splitter
          horizontal
          label="Resize terminal"
          value={height}
          min={DRAWER_HEIGHT.min}
          max={DRAWER_HEIGHT.max}
          onMove={(y) => {
            const bottom = root.current?.getBoundingClientRect().bottom
            if (bottom) onHeight(bottom - y)
          }}
          onReset={() => onHeight(DRAWER_HEIGHT.initial)}
        />
      )}
      <div className="drawer-head">
        <button className="drawer-bar" onClick={onToggle} aria-expanded={open}>
          <Icon name="terminal" size={13} />
          Terminal
          <kbd>{`${MOD}T`}</kbd>
          <Icon name="chevron" size={13} />
        </button>
        {open && (
          <div className="drawer-tabs" role="tablist">
            {tabs.map((tab, i) => (
              <span key={tab} className="drawer-tab" aria-selected={tab === active} role="tab">
                <button onClick={() => show(tab)}>{i + 1}</button>
                {tabs.length > 1 && (
                  <button
                    aria-label={`Close terminal ${i + 1}`}
                    title={`Close terminal (${MOD}⇧W)`}
                    onClick={() => closeTab(tab)}
                  >
                    <Icon name="x" size={11} />
                  </button>
                )}
              </span>
            ))}
            <button
              className="drawer-add"
              aria-label="New terminal"
              title={`New terminal (${MOD}⇧T)`}
              onClick={addTab}
            >
              <Icon name="plus" size={13} />
            </button>
          </div>
        )}
      </div>
      {started && (
        <div className="drawer-body" style={{ height, display: open ? 'block' : 'none' }}>
          {tabs.map((tab) => (
            <div key={tab} className="drawer-pane" hidden={tab !== active}>
              <Terminal id={tab} cwd={cwd} port={port} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
