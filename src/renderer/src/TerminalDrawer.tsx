import { useRef, useState } from 'react'
import { Icon } from './icons'
import { MOD } from './platform'
import { Splitter } from './Splitter'
import { Terminal } from './Terminal'
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

/** A shell at the bottom of a column. Its bar always shows; the shell starts on first open. */
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
  // Once started the shell stays alive while folded, so a dev server keeps running.
  const [started, setStarted] = useState(open)
  if (open && !started) setStarted(true)

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
      <button className="drawer-bar" onClick={onToggle} aria-expanded={open}>
        <Icon name="terminal" size={13} />
        Terminal
        <kbd>{`${MOD}T`}</kbd>
        <Icon name="chevron" size={13} />
      </button>
      {started && (
        <div className="drawer-body" style={{ height, display: open ? 'block' : 'none' }}>
          <Terminal id={id} cwd={cwd} port={port} />
        </div>
      )}
    </div>
  )
}
