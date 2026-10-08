const KEY_STEP = 16

interface Props {
  label: string
  /** Current size, for assistive tech. */
  value: number
  min: number
  max: number
  /** Called with the pointer's x (y when horizontal) while dragging, or ± a step from the keyboard. */
  onMove: (client: number) => void
  onReset: () => void
  /** A horizontal divider sits between panes stacked top to bottom. */
  horizontal?: boolean
}

/** A divider: drag it, nudge it with arrow keys, or double-click to reset. */
export function Splitter({
  label,
  value,
  min,
  max,
  onMove,
  onReset,
  horizontal = false
}: Props): React.JSX.Element {
  const center = (el: HTMLElement): number => {
    const box = el.getBoundingClientRect()
    return horizontal ? box.top + box.height / 2 : box.left + box.width / 2
  }
  const steps: Record<string, number> = horizontal
    ? { ArrowUp: -KEY_STEP, ArrowDown: KEY_STEP }
    : { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP }
  return (
    <div
      className={horizontal ? 'splitter horizontal' : 'splitter'}
      role="separator"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          onMove(horizontal ? e.clientY : e.clientX)
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = steps[e.key]
        if (!step) return
        e.preventDefault()
        onMove(center(e.currentTarget) + step)
      }}
    />
  )
}
