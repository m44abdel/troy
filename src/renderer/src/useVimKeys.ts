import { useEffect, useEffectEvent } from 'react'
import { createVim, type VimCommand, type VimZone } from '../../shared/vim'

const LINE_SCROLL_PX = 40

function zoneOf(el: Element | null): VimZone | null {
  // Terminals and text fields keep every key.
  if (!el || el.closest('.xterm, input, textarea')) return null
  if (el.closest('.sidebar')) return 'sidebar'
  if (el.closest('.diff-files')) return 'diff'
  return null
}

function scrollDiff(container: Element, command: VimCommand): void {
  if (command === 'down' || command === 'up')
    return container.scrollBy({ top: command === 'down' ? LINE_SCROLL_PX : -LINE_SCROLL_PX })
  if (command === 'top') return container.scrollTo({ top: 0 })
  if (command === 'bottom') return container.scrollTo({ top: container.scrollHeight })
  const top = container.getBoundingClientRect().top
  const hunks = [...container.querySelectorAll('.diff-hunk')]
  const target =
    command === 'nextHunk'
      ? hunks.find((h) => h.getBoundingClientRect().top > top + 1)
      : hunks.findLast((h) => h.getBoundingClientRect().top < top - 1)
  target?.scrollIntoView({ block: 'start' })
}

/** Vim keys for the sidebar and diff while `enabled`; sidebar commands go to `onSidebar`. */
export function useVimKeys(enabled: boolean, onSidebar: (command: VimCommand) => void): void {
  const sidebar = useEffectEvent(onSidebar)

  useEffect(() => {
    if (!enabled) return
    const vim = createVim()
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement
      const zone = zoneOf(el)
      if (!zone) return
      const command = vim(zone, e.key)
      if (!command) return
      e.preventDefault()
      if (command === 'pending') return
      if (zone === 'sidebar') sidebar(command)
      else scrollDiff(el!.closest('.diff-files')!, command)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
