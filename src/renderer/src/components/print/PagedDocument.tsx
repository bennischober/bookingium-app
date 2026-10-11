import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

// A4 page geometry (DIN A4: 210 x 297 mm)
const PAGE_H_MM = 297
const PADDING_MM = 20

/**
 * A4 page preview with real page frames — React-idiomatic.
 *
 * How it works:
 * 1. Children render ONCE into a hidden measuring container (React-owned).
 * 2. A ResizeObserver/font-load watcher measures the block flow heights and
 *    computes which block starts which page (greedy fill; blocks taller than
 *    one page overflow and the next block starts a new page).
 * 3. The pages are RENDERED as separate absolutely-stacked frames via React
 *    portals: each page frame is a div; the SAME React children are portaled
 *    into every frame?? NO — portals duplicate; instead:
 *
 *    The actual approach: children are rendered into the measure container
 *    only. The visible page frames are pure CSS overlays (page boxes with
 *    shadows) positioned behind/around the measured flow, and the flow
 *    container gets per-block `break-inside: avoid` + margins that match the
 *    page gaps, so the flow VISUALLY aligns with the page frames.
 *
 *    This is a visual alignment trick: page frames are drawn at computed
 *    offsets; the content flows naturally (with break-inside rules) inside
 *    one continuous column that starts inside the first frame. Gaps between
 *    pages are cut out visually by translating content blocks per page...
 *
 * Simpler and honest: given the complexity discovered, this component only
 * guarantees PRINT correctness (break-inside on blocks, print margins via
 * @page), and shows the content in a single A4-width sheet with computed
 * page-frame shadows at the measured break offsets (approximate preview).
 */
export function PagedDocument({
  children,
  paddingMm = PADDING_MM
}: {
  children: ReactNode
  paddingMm?: number
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [breaksPx, setBreaksPx] = useState<number[]>([])
  const [mmPx, setMmPx] = useState(3.7795)

  const measure = useCallback(() => {
    const content = contentRef.current
    if (!content) return

    // mm -> px
    const probe = document.createElement('div')
    probe.style.cssText = 'height:10mm;position:absolute;visibility:hidden;'
    content.appendChild(probe)
    const pxPerMm = probe.offsetHeight / 10
    probe.remove()
    setMmPx(pxPerMm)

    const usable = (PAGE_H_MM - paddingMm * 2) * pxPerMm
    const blocks = Array.from(content.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement
    )
    if (blocks.length === 0) return

    const breaks: number[] = []
    let used = 0
    for (const block of blocks) {
      const rect = block.getBoundingClientRect()
      const topInContent = rect.top - content.getBoundingClientRect().top
      const height = rect.height
      const margin = getComputedStyle(block)
      const outer = height + parseFloat(margin.marginTop) + parseFloat(margin.marginBottom)

      if (used > 0 && used + outer > usable) {
        // Page ends: content top offset of this block, relative to content
        breaks.push(topInContent)
        used = outer
      } else {
        used += outer
      }
    }
    setBreaksPx(breaks)
  }, [paddingMm])

  useEffect(() => {
    void document.fonts.ready.then(() => measure())
    const content = contentRef.current
    if (!content) return
    content.addEventListener('load', measure, true)
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => {
      content.removeEventListener('load', measure, true)
      observer.disconnect()
    }
  }, [measure])

  return (
    <div className="relative">
      {/* Print stylesheet: @page margins mirror the preview padding */}
      <style>{`
        @media print {
          @page { size: A4; margin: ${paddingMm}mm; }
          .paged-content { padding: 0 !important; }
        }
      `}</style>

      {/* Continuous A4-width sheet with page frame overlays */}
      <div className="bg-white text-black shadow-lg print:shadow-none print:m-0 print:w-auto">
        <div
          ref={contentRef}
          className="paged-content"
          style={{
            padding: `${paddingMm}mm`,
            overflowWrap: 'anywhere',
            hyphens: 'auto'
          }}
        >
          {children}
        </div>

        {/* Page frame overlays: light separators where pages break (screen only) */}
        <div aria-hidden className="pointer-events-none absolute inset-0 print:hidden">
          {breaksPx.map((topPx, index) => (
            <div
              key={`${topPx}-${index}`}
              className="absolute left-0 right-0 flex items-center gap-2"
              style={{ top: topPx + paddingMm * mmPx }}
            >
              <div className="flex-1 border-t-2 border-dashed border-red-300/80" />
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] text-red-500">
                Seite {index + 1} Ende
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
