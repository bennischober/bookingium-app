import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { clampWidth as clamp } from '@/hooks/useStoredWidth'

const KEY_STEP = 16

/**
 * Vertical splitter between two panes: drag, arrow keys (Shift for bigger
 * steps), Home/End, double-click resets. It resizes the pane on its left.
 */
export function PaneResizer({
  label,
  width,
  defaultWidth,
  min,
  max,
  onResize,
  className
}: {
  label: string
  width: number
  defaultWidth: number
  min: number
  max: number
  onResize: (width: number) => void
  className?: string
}) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const bounds = { min, max }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    // Start from the drawn width: CSS (a max-width) may hold the pane narrower
    const pane = event.currentTarget.previousElementSibling
    const startWidth = pane ? pane.getBoundingClientRect().width : width
    drag.current = { startX: event.clientX, startWidth }
    setDragging(true)
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    onResize(clamp(drag.current.startWidth + event.clientX - drag.current.startX, bounds))
  }
  const endDrag = () => {
    drag.current = null
    setDragging(false)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP
    const next =
      event.key === 'ArrowLeft'
        ? width - step
        : event.key === 'ArrowRight'
          ? width + step
          : event.key === 'Home'
            ? min
            : event.key === 'End'
              ? max
              : null
    if (next === null) return
    event.preventDefault()
    onResize(clamp(next, bounds))
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Ziehen zum Ändern der Breite, Doppelklick setzt zurück"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={() => onResize(clamp(defaultWidth, bounds))}
      onKeyDown={onKeyDown}
      className={cn(
        // A 1px line with a wider grab area; touch-none keeps touch drags from scrolling
        'group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none outline-none select-none',
        className
      )}
    >
      <div
        className={cn(
          'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors',
          'group-hover:w-0.5 group-hover:bg-primary/40 group-focus-visible:w-0.5 group-focus-visible:bg-ring',
          dragging && 'w-0.5 bg-primary/60'
        )}
      />
      {/* While dragging, iframes (the mail body) must not swallow the pointer */}
      {dragging && <div className="fixed inset-0 cursor-col-resize" />}
    </div>
  )
}
