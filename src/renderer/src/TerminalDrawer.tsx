import { useRef, useState } from 'react'
import { Icon } from './icons'
import { MOD } from './platform'
import { Splitter } from './Splitter'
import { Terminal } from './Terminal'
import { activeDrawerTab, focusTerminal } from './terminals'
import { DRAWER_HEIGHT } from './useDrawer'

interface Props {
  id: string
  cwd: string
  port?: number
  open: boolean
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
  activeDrawerTab.set(id, active)

  const show = (tab: string): void => {
    setActive(tab)
    requestAnimationFrame(() => focusTerminal(tab))
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
                  <button aria-label={`Close terminal ${i + 1}`} onClick={() => closeTab(tab)}>
                    <Icon name="x" size={11} />
                  </button>
                )}
              </span>
            ))}
            <button className="drawer-add" aria-label="New terminal" onClick={addTab}>
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
