const KEY_STEP = 16

interface Props {
  label: string
  /** Current size, for assistive tech. */
  value: number
  min: number
  max: number
  /** Called with the pointer's x while dragging, or the current x ± a step from the keyboard. */
  onMove: (clientX: number) => void
  onReset: () => void
}

/** A vertical divider: drag it, nudge it with arrow keys, or double-click to reset. */
export function Splitter({ label, value, min, max, onMove, onReset }: Props): React.JSX.Element {
  const center = (el: HTMLElement): number => {
    const box = el.getBoundingClientRect()
    return box.left + box.width / 2
  }
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
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
        if (e.currentTarget.hasPointerCapture(e.pointerId)) onMove(e.clientX)
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP }[e.key]
        if (!step) return
        e.preventDefault()
        onMove(center(e.currentTarget) + step)
      }}
    />
  )
}
