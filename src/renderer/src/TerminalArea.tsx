import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { AppAction } from '../../shared/keys'
import { layout, leaf, leaves, type Divider, type Rect, type SplitDir } from '../../shared/panes'
import { Icon } from './icons'
import { MOD } from './platform'
import { Splitter } from './Splitter'
import * as T from './tabs'
import { Terminal, type TerminalProps } from './Terminal'
import { agentId, focusTerminal, focusedPanes, paneId } from './terminals'
import { useStored } from './useStored'

const SETUP_COMMAND = 'sh .troy/setup.sh\r'
const FULL: Rect = { x: 0, y: 0, w: 100, h: 100 }

interface Props {
  path: string
  port?: number
  /** Whether this area is on screen, so the tab and pane shortcuts are its own. */
  visible: boolean
  /** How the agent's pane starts its CLI. */
  agent: Omit<TerminalProps, 'id' | 'cwd' | 'port'>
  /** The label of the agent's tab. */
  agentTitle: React.ReactNode
  /** A worktree created this session: its layout starts over and may run the setup script. */
  firstRun?: { setup: boolean }
  /** Closing the agent's pane or tab ends the session. */
  onCloseAgent: () => void
  /** Sits at the right end of the tab strip. */
  toolbar?: React.ReactNode
}

const position = (r: Rect): React.CSSProperties => ({
  left: `${r.x}%`,
  top: `${r.y}%`,
  width: `${r.w}%`,
  height: `${r.h}%`
})

const dividerAt = ({ dir, box, ratio }: Divider): React.CSSProperties =>
  dir === 'row'
    ? { left: `${box.x + box.w * ratio}%`, top: `${box.y}%`, height: `${box.h}%` }
    : { top: `${box.y + box.h * ratio}%`, left: `${box.x}%`, width: `${box.w}%` }

/** Tabs of terminals, each split into panes like Orca's. The agent's tab comes first. */
export function TerminalArea({
  path,
  port,
  visible,
  agent,
  agentTitle,
  firstRun,
  onCloseAgent,
  toolbar
}: Props): React.JSX.Element {
  const agentPane = agentId(path)
  const body = useRef<HTMLDivElement>(null)
  const [setupPane] = useState(() => (firstRun?.setup ? paneId(path) : undefined))
  const [tabs, setTabs] = useStored(
    `troy.tabs:${path}`,
    T.initialTabs(agentPane, setupPane),
    (v): v is T.Tabs => T.isTabs(v) && T.tabOf(v, agentPane)?.id === T.AGENT_TAB,
    !!firstRun
  )
  const current = T.activeTab(tabs)

  // The cursor follows the focused pane whenever it or the tab changes, but not on mount.
  const focusKey = `${current.id}\0${current.focus}`
  const lastFocus = useRef(focusKey)
  useEffect(() => {
    focusedPanes.set(path, current.focus)
    if (lastFocus.current === focusKey) return
    lastFocus.current = focusKey
    focusTerminal(current.focus)
  })

  const splitAt = (pane: string, dir: SplitDir): void => {
    const id = paneId(path)
    setTabs((t) => T.splitPane(T.focusPane(t, pane), dir, id))
  }
  const closeAt = (pane: string): void =>
    pane === agentPane ? onCloseAgent() : setTabs((t) => T.closePane(t, pane))
  const addTab = (): void => {
    const id = paneId(path)
    const tabId = crypto.randomUUID()
    setTabs((t) =>
      T.openTab(t, { id: tabId, title: `Terminal ${t.list.length}`, root: leaf(id), focus: id })
    )
  }
  const closeTab = (id: string): void =>
    id === T.AGENT_TAB ? onCloseAgent() : setTabs((t) => T.closeTab(t, id))

  const onAction = useEffectEvent((action: AppAction) => {
    if (action === 'splitRight') return splitAt(current.focus, 'row')
    if (action === 'splitDown') return splitAt(current.focus, 'column')
    if (action === 'closePane') return closeAt(current.focus)
    if (action === 'closeTab') return closeTab(current.id)
    if (action === 'newTab') return addTab()
    if (action === 'prevPane' || action === 'nextPane')
      return setTabs((t) => T.stepPane(t, action === 'prevPane' ? -1 : 1))
    if (action === 'prevTab' || action === 'nextTab')
      return setTabs((t) => T.stepTab(t, action === 'prevTab' ? -1 : 1))
    if (action === 'zoomPane') setTabs(T.toggleZoom)
  })
  useEffect(() => (visible ? window.api.onAction(onAction) : undefined), [visible])

  const resize = (d: Divider, client: number): void => {
    const area = body.current?.getBoundingClientRect()
    if (!area) return
    const [start, size] =
      d.dir === 'row'
        ? [area.left + (area.width * d.box.x) / 100, (area.width * d.box.w) / 100]
        : [area.top + (area.height * d.box.y) / 100, (area.height * d.box.h) / 100]
    if (size > 0) setTabs((t) => T.resizeSplit(t, current.id, d.path, (client - start) / size))
  }

  // Every pane of every tab renders in one flat list, so a split never remounts a terminal.
  const panes = tabs.list.flatMap((tab) => {
    const { rects } = layout(tab.root)
    const split = leaves(tab.root).length > 1
    return leaves(tab.root).map((id) => {
      const shown = tab.id === tabs.active && (!tab.zoomed || tab.zoomed === id)
      const classes = [
        'pane-slot',
        id === agentPane ? 'pane-agent' : 'pane-shell',
        split && id === tab.focus ? 'focused' : ''
      ]
      return (
        <div
          key={id}
          className={classes.join(' ')}
          style={{
            ...position(tab.zoomed === id ? FULL : rects[id]),
            display: shown ? '' : 'none'
          }}
          onFocusCapture={() => tab.focus !== id && setTabs((t) => T.focusPane(t, id))}
        >
          <PaneTools
            onSplit={(dir) => splitAt(id, dir)}
            onClose={id === agentPane ? undefined : () => closeAt(id)}
          />
          {id === agentPane ? (
            <Terminal id={id} cwd={path} port={port} {...agent} />
          ) : (
            <Terminal
              id={id}
              cwd={path}
              port={port}
              command={tab.commands?.[id]}
              initialInput={id === setupPane ? SETUP_COMMAND : undefined}
            />
          )}
        </div>
      )
    })
  })

  return (
    <div className="terminal-area">
      <div className="tab-strip" role="tablist">
        {tabs.list.map((tab) => (
          <div key={tab.id} role="tab" className="term-tab" aria-selected={tab.id === tabs.active}>
            <button onClick={() => setTabs((t) => ({ ...t, active: tab.id }))}>
              {tab.id === T.AGENT_TAB ? agentTitle : tab.title}
            </button>
            {tab.id !== T.AGENT_TAB && (
              <button
                className="term-tab-close"
                aria-label={`Close ${tab.title}`}
                title={`Close tab (${MOD}⇧W)`}
                onClick={() => closeTab(tab.id)}
              >
                <Icon name="x" size={11} />
              </button>
            )}
          </div>
        ))}
        <button
          className="icon-button tab-add"
          aria-label="New terminal"
          title={`New terminal (${MOD}T)`}
          onClick={addTab}
        >
          <Icon name="plus" size={14} />
        </button>
        <span className="tab-strip-fill" />
        {toolbar}
      </div>
      <div className="tab-body" ref={body}>
        {panes}
        {!current.zoomed &&
          layout(current.root).dividers.map((d) => (
            <div
              key={`divider:${current.id}:${d.path}`}
              className={`pane-divider ${d.dir}`}
              style={dividerAt(d)}
            >
              <Splitter
                horizontal={d.dir === 'column'}
                label="Resize panes"
                value={d.ratio * 100}
                min={10}
                max={90}
                onMove={(client) => resize(d, client)}
                onReset={() => setTabs((t) => T.resizeSplit(t, current.id, d.path, 0.5))}
              />
            </div>
          ))}
      </div>
    </div>
  )
}

function PaneTools({
  onSplit,
  onClose
}: {
  onSplit: (dir: SplitDir) => void
  onClose?: () => void
}): React.JSX.Element {
  return (
    <div className="pane-tools">
      <button
        className="icon-button"
        aria-label="Split right"
        title={`Split right (${MOD}D)`}
        onClick={() => onSplit('row')}
      >
        <Icon name="splitRight" size={13} />
      </button>
      <button
        className="icon-button"
        aria-label="Split down"
        title={`Split down (${MOD}⇧D)`}
        onClick={() => onSplit('column')}
      >
        <Icon name="splitDown" size={13} />
      </button>
      {onClose && (
        <button
          className="icon-button"
          aria-label="Close pane"
          title={`Close pane (${MOD}W)`}
          onClick={onClose}
        >
          <Icon name="x" size={13} />
        </button>
      )}
    </div>
  )
}
