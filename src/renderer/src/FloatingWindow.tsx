import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import type { AppAction } from '../../shared/keys'
import type { NoteInfo } from '../../shared/types'
import * as F from './floating'
import { Icon, type IconName } from './icons'
import { NoteTab } from './NoteTab'
import { MOD } from './platform'
import { Terminal } from './Terminal'
import { focusTerminal, paneId } from './terminals'
import { timeAgo } from './timeAgo'
import { isBoolean, useStored } from './useStored'

const BUTTON: F.Size = { w: 36, h: 36 }
// Bottom-right, clear of the status bar.
const BUTTON_START: F.Anchored = { x: 16, y: 42, right: true, bottom: true }
const MIN: F.Size = { w: 360, h: 240 }
// A press that moves less than this is still a click.
const DRAG_THRESHOLD_PX = 4
// A resize is saved once the corner has held still this long.
const SAVE_SIZE_DELAY_MS = 200
// Cmd+Alt is a macOS-only layer; elsewhere the button is the way in.
const TOGGLE_KEY = MOD === '⌘' ? '⌘⌥A' : null

const viewport = (): F.Size => ({ w: window.innerWidth, h: window.innerHeight })

function useViewport(): F.Size {
  const [size, setSize] = useState(viewport)
  useEffect(() => {
    const onResize = (): void => setSize(viewport())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

interface DragHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void
  onLostPointerCapture: () => void
}

/**
 * Reports how far a press has moved while it is held, then once more when it lets go. The
 * element moves by writing its style directly, so nothing re-renders until the release.
 */
function useDrag(onMove: (by: F.Point) => void, onEnd: (by: F.Point) => void): DragHandlers {
  const start = useRef<F.Point | null>(null)
  const by = useRef<F.Point>({ x: 0, y: 0 })
  return {
    onPointerDown: (e) => {
      if (e.button !== 0) return
      start.current = { x: e.clientX, y: e.clientY }
      by.current = { x: 0, y: 0 }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e) => {
      if (!start.current) return
      by.current = { x: e.clientX - start.current.x, y: e.clientY - start.current.y }
      onMove(by.current)
    },
    // Pointer up and pointer cancel both end here.
    onLostPointerCapture: () => {
      if (!start.current) return
      start.current = null
      onEnd(by.current)
    }
  }
}

const moveTo = (el: HTMLElement | null, p: F.Point): void => {
  if (!el) return
  el.style.left = `${p.x}px`
  el.style.top = `${p.y}px`
}

/** The round button that shows and hides the floating window; drag it anywhere. */
function FloatingToggle({
  open,
  onToggle
}: {
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const vp = useViewport()
  const [at, setAt] = useStored('troy.floating.button', BUTTON_START, F.isAnchored)
  const spot = F.place(at, BUTTON, vp)
  const button = useRef<HTMLButtonElement>(null)
  // Set once a press moves past the threshold, so the click that ends a drag is ignored.
  const dragged = useRef(false)
  const dropAt = (by: F.Point): F.Point =>
    F.inside({ x: spot.x + by.x, y: spot.y + by.y }, BUTTON, vp)
  const drag = useDrag(
    (by) => {
      if (Math.hypot(by.x, by.y) > DRAG_THRESHOLD_PX) dragged.current = true
      if (dragged.current) moveTo(button.current, dropAt(by))
    },
    (by) => dragged.current && setAt(F.anchor(dropAt(by), BUTTON, vp))
  )
  const label = TOGGLE_KEY ? `Floating window (${TOGGLE_KEY})` : 'Floating window'
  return (
    <button
      ref={button}
      className={open ? 'floating-toggle on' : 'floating-toggle'}
      style={{ left: spot.x, top: spot.y }}
      aria-label="Floating window"
      aria-pressed={open}
      title={label}
      {...drag}
      onPointerDown={(e) => {
        dragged.current = false
        drag.onPointerDown(e)
      }}
      onClick={() => {
        if (!dragged.current) onToggle()
        dragged.current = false
      }}
      // A drag the system cancelled sends no click; Enter or Space must still work after it.
      onKeyDown={() => (dragged.current = false)}
    >
      <Icon name="floating" />
    </button>
  )
}

interface MenuItem {
  icon: IconName
  label: string
  keys: string
  run: () => void
}

function Menu({ items }: { items: MenuItem[] }): React.JSX.Element {
  return (
    <div className="floating-menu">
      {items.map((item) => (
        <button key={item.label} className="floating-menu-item" onClick={item.run}>
          <Icon name={item.icon} size={14} />
          <span className="floating-menu-label">{item.label}</span>
          <kbd>{item.keys}</kbd>
        </button>
      ))}
    </div>
  )
}

/** The notes folder, newest first, to open one in a tab. */
function NoteList({
  onOpen,
  onBack
}: {
  onOpen: (name: string) => void
  onBack: () => void
}): React.JSX.Element {
  const [notes, setNotes] = useState<NoteInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    window.api.listNotes().then(({ notes, error }) => {
      if (notes) setNotes(notes)
      else setError(error ?? 'Could not list the notes.')
    })
  }, [])
  const reveal = async (): Promise<void> => setError((await window.api.revealNotes()).error ?? null)
  return (
    <div className="floating-menu">
      <div className="floating-menu-head">
        <button className="secondary" onClick={onBack}>
          Back
        </button>
        <span className="floating-menu-label">Notes</span>
        <button className="secondary" onClick={reveal}>
          <Icon name="folder" size={13} />
          Open notes folder
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {notes?.length === 0 && <p className="muted">No notes yet.</p>}
      {notes?.map((note) => (
        <button key={note.name} className="floating-menu-item" onClick={() => onOpen(note.name)}>
          <Icon name="file" size={14} />
          <span className="floating-menu-label">{note.name.replace(/\.md$/, '')}</span>
          <span className="muted">{timeAgo(note.modified)}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * A window above everything else, with tabs of shells that start in the home folder and
 * Markdown notes, for work that spans repos. Hidden, its shells keep running.
 */
export function FloatingWindow({ onHidden }: { onHidden: () => void }): React.JSX.Element {
  const [open, setOpen] = useStored('troy.floating.open', false, isBoolean)
  const [maximized, setMaximized] = useStored('troy.floating.maximized', false, isBoolean)
  const [tabs, setTabs] = useStored('troy.floating.tabs', F.NO_TABS, F.isFloatTabs)
  const vp = useViewport()
  const [saved, setRect] = useStored('troy.floating.rect', F.centered(viewport(), MIN), F.isRect)
  // A smaller app window squeezes the floating one without forgetting its saved size.
  const rect = F.fitRect(saved, vp, MIN)
  // Mounted on first open, then kept, so hiding it leaves the shells running.
  const [mounted, setMounted] = useState(open)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const win = useRef<HTMLDivElement>(null)
  const shown = useRef(rect)
  const active = F.activeFloatTab(tabs)

  if (open && !mounted) setMounted(true)

  const hide = (): void => {
    setOpen(false)
    onHidden()
  }
  // Each way in clears the last error, which is about whatever was tried before, and leaves
  // the notes list, so closing what it opens goes back to the menu.
  const show = (): void => {
    setOpen(true)
    setError(null)
    setPicking(false)
  }
  const showMenu = (): void => {
    show()
    setTabs((t) => ({ ...t, active: null }))
  }
  const newTerminal = (): void => {
    show()
    const id = paneId('floating')
    setTabs((t) => {
      const n = t.list.filter((tab) => tab.kind === 'terminal').length + 1
      return F.openTab(t, { id, kind: 'terminal', title: `Terminal ${n}` })
    })
  }
  const openNote = (name: string): void => {
    show()
    setTabs((t) => F.openNote(t, crypto.randomUUID(), name))
  }
  const newNote = async (): Promise<void> => {
    show()
    const { name, error } = await window.api.createNote()
    if (name) openNote(name)
    else setError(error ?? 'Could not make a note.')
  }
  const pickNote = (): void => {
    show()
    setTabs((t) => ({ ...t, active: null }))
    setPicking(true)
  }
  const closeTab = (id: string): void => setTabs((t) => F.closeTab(t, id))

  const onAction = useEffectEvent((action: AppAction) => {
    if (action === 'toggleFloating') return open ? hide() : show()
    if (action === 'newNote') return void newNote()
    if (action === 'openNote') return pickNote()
    if (!open || !F.focusInFloating()) return
    if (action === 'newTab') return newTerminal()
    // The tab active now, which a key pressed just before may have changed since the render.
    if (action === 'closePane' || action === 'closeTab')
      return active ? setTabs((t) => (t.active ? F.closeTab(t, t.active) : t)) : hide()
    if (action === 'prevTab' || action === 'nextTab')
      setTabs((t) => F.stepTab(t, action === 'prevTab' ? -1 : 1))
  })
  useEffect(() => window.api.onAction(onAction), [])

  // The cursor follows the tab that shows. A tab that closes or hides drops the focus, and a
  // key landing before the next tab takes it would reach the worktree behind (a second Cmd-W
  // would close its session). So the window itself takes the focus first, before the next
  // key is handled; then a terminal takes it once mounted, and a note once it loads.
  const focusKey = open ? (tabs.active ?? (picking ? 'notes' : 'menu')) : ''
  const parked = useRef(focusKey)
  useLayoutEffect(() => {
    if (parked.current === focusKey) return
    parked.current = focusKey
    if (open) win.current?.focus()
  })
  const lastFocus = useRef(focusKey)
  useEffect(() => {
    if (lastFocus.current === focusKey) return
    lastFocus.current = focusKey
    if (open && active?.kind === 'terminal') focusTerminal(active.id)
  })

  // Only a resize from the corner is saved, not the squeeze from a smaller app window.
  useEffect(() => {
    shown.current = rect
  })
  useEffect(() => {
    const el = win.current
    if (!el || maximized) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const box = el.getBoundingClientRect()
        const was = shown.current
        if (!box.width || (box.width === was.w && box.height === was.h)) return
        const next = F.fitRect(
          { x: box.left, y: box.top, w: box.width, h: box.height },
          viewport(),
          MIN
        )
        // Past the edge of the app window, the corner snaps back to what fits.
        el.style.width = `${next.w}px`
        el.style.height = `${next.h}px`
        setRect(next)
      }, SAVE_SIZE_DELAY_MS)
    })
    observer.observe(el)
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [mounted, maximized, setRect])

  const dropAt = (by: F.Point): F.FloatRect =>
    F.fitRect({ ...rect, x: rect.x + by.x, y: rect.y + by.y }, vp, MIN)
  // Only the place is saved: a window squeezed by a small app window keeps its own size.
  // A click without a move saves nothing.
  const drag = useDrag(
    (by) => moveTo(win.current, dropAt(by)),
    (by) => {
      if (!by.x && !by.y) return
      const { x, y } = dropAt(by)
      setRect({ ...saved, x, y })
    }
  )
  // The tab strip is the title bar: its empty space drags the window and a double-click
  // maximizes it, as in a native window.
  const onStrip = (e: React.PointerEvent<HTMLElement>): boolean =>
    !maximized && !(e.target as HTMLElement).closest('button')

  const items: MenuItem[] = [
    { icon: 'terminal', label: 'New Terminal', keys: `${MOD}T`, run: newTerminal },
    { icon: 'file', label: 'New Markdown Note', keys: `${MOD}⇧M`, run: () => void newNote() },
    { icon: 'file', label: 'Open Markdown Note', keys: `${MOD}⇧O`, run: pickNote },
    { icon: 'minus', label: 'Minimize', keys: `${MOD}W`, run: hide }
  ]

  return (
    <>
      {mounted && (
        <div
          ref={win}
          className={maximized ? 'floating maximized' : 'floating'}
          style={{
            ...(maximized ? {} : { left: rect.x, top: rect.y, width: rect.w, height: rect.h }),
            display: open ? '' : 'none'
          }}
          role="dialog"
          aria-label="Floating window"
          tabIndex={-1}
        >
          <div
            className="tab-strip"
            role="tablist"
            {...drag}
            onPointerDown={(e) => onStrip(e) && drag.onPointerDown(e)}
            onDoubleClick={(e) =>
              !(e.target as HTMLElement).closest('button') && setMaximized((m) => !m)
            }
          >
            {tabs.list.map((tab) => (
              <div
                key={tab.id}
                role="tab"
                className="term-tab"
                aria-selected={tab.id === tabs.active}
              >
                <button onClick={() => setTabs((t) => ({ ...t, active: tab.id }))}>
                  <Icon name={tab.kind === 'note' ? 'file' : 'terminal'} size={12} />
                  {tab.title}
                </button>
                <button
                  className="term-tab-close"
                  aria-label={`Close ${tab.title}`}
                  title={`Close tab (${MOD}W)`}
                  onClick={() => closeTab(tab.id)}
                >
                  <Icon name="x" size={11} />
                </button>
              </div>
            ))}
            <button
              className="icon-button tab-add"
              aria-label="New tab"
              title="New tab"
              onClick={showMenu}
            >
              <Icon name="plus" size={14} />
            </button>
            <span className="tab-strip-fill" />
            <button
              className="icon-button"
              aria-label={maximized ? 'Restore' : 'Maximize'}
              title={maximized ? 'Restore' : 'Maximize'}
              onClick={() => setMaximized((m) => !m)}
            >
              <Icon name={maximized ? 'restore' : 'maximize'} size={14} />
            </button>
            <button
              className="icon-button"
              aria-label="Minimize"
              title={TOGGLE_KEY ? `Minimize (${TOGGLE_KEY})` : 'Minimize'}
              onClick={hide}
            >
              <Icon name="minus" size={14} />
            </button>
          </div>
          <div className="floating-body">
            {tabs.list.map((tab) => (
              <div
                key={tab.id}
                className="floating-slot"
                style={{ display: tab.id === tabs.active ? '' : 'none' }}
              >
                {tab.kind === 'terminal' ? (
                  <Terminal id={tab.id} cwd={window.api.homeDir} />
                ) : (
                  <NoteTab name={tab.note ?? ''} active={open && tab.id === tabs.active} />
                )}
              </div>
            ))}
            {!active &&
              (picking ? (
                <NoteList onOpen={openNote} onBack={() => setPicking(false)} />
              ) : (
                <Menu items={items} />
              ))}
            {error && <p className="error floating-error">{error}</p>}
          </div>
        </div>
      )}
      <FloatingToggle open={open} onToggle={() => (open ? hide() : show())} />
    </>
  )
}
