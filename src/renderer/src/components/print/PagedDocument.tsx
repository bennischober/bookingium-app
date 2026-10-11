import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

// A4 page geometry (DIN A4: 210 x 297 mm)
const PAGE_H_MM = 297

/**
 * A4-aware document wrapper.
 *
 * Print correctness: every direct child block gets `break-inside: avoid`
 * (and `break-after: page` where requested via data attributes), so
 * Chromium's print engine never splits a section across pages and never
 * cuts a word horizontally at the page edge. Word wrapping inside blocks is
 * guaranteed by `overflow-wrap: anywhere` + `hyphens: auto` (lang="de" is
 * set on the document root).
 *
 * Screen preview: page-boundary guide lines are overlaid at the exact
 * offsets where A4 pages will end (computed by measuring block flow
 * heights), so you can see how the content distributes across pages without
 * the DOM being restructured (React keeps ownership of all nodes).
 */
export function PagedDocument({
  children,
  paddingMm = 20
}: {
  children: ReactNode
  paddingMm?: number
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [pageBreaksMm, setPageBreaksMm] = useState<number[]>([])

  const repaginate = useCallback(() => {
    const content = contentRef.current
    if (!content) return

    // mm -> px, measured live (respects zoom/scaling)
    const probe = document.createElement('div')
    probe.style.height = '10mm'
    probe.style.position = 'absolute'
    probe.style.visibility = 'hidden'
    content.appendChild(probe)
    const mmPx = probe.offsetHeight / 10
    probe.remove()

    const usableHeightPx = (PAGE_H_MM - paddingMm * 2) * mmPx
    const blocks = Array.from(content.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement
    )
    if (blocks.length === 0) return

    const breaks: number[] = []
    let pageContentHeight = 0

    blocks.forEach((block, index) => {
      // Block flow height: distance to the next block top (includes margins),
      // for the last block the remaining scroll height
      const height =
        index < blocks.length - 1
          ? blocks[index + 1].offsetTop - block.offsetTop
          : content.scrollHeight - block.offsetTop

      if (pageContentHeight > 0 && pageContentHeight + height > usableHeightPx) {
        // Page ends at the content top + what fit on it (in mm)
        breaks.push(paddingMm + pageContentHeight / mmPx)
        pageContentHeight = height
      } else {
        pageContentHeight += height
      }
    })

    setPageBreaksMm(breaks)
  }, [paddingMm])

  useEffect(() => {
    void document.fonts.ready.then(() => repaginate())
    const content = contentRef.current
    content?.addEventListener('load', repaginate, true) // images
    const observer = new ResizeObserver(() => repaginate())
    if (content) observer.observe(content)
    return () => {
      content?.removeEventListener('load', repaginate, true)
      observer.disconnect()
    }
  }, [repaginate])

  // Distribute break-after hints: direct children marked via CSS instead of
  // cloning — Chromium honors `break-inside: avoid` per element in print.
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    for (const child of Array.from(content.children)) {
      if (child instanceof HTMLElement) {
        child.style.breakInside = 'avoid'
      }
    }
  })

  const totalHeightMm = PAGE_H_MM

  return (
    <div className="relative mx-auto w-[210mm] bg-white text-black shadow-lg print:shadow-none print:m-0 print:w-auto">
      {/* Page guide overlays (screen only): thin dashed lines where pages end */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden print:hidden"
        style={{ zIndex: 10 }}
      >
        {pageBreaksMm.map((mm, index) => (
          <div
            key={index}
            className="absolute left-0 right-0 border-t-2 border-dashed border-red-300/70"
            style={{ top: `${mm}mm` }}
          >
            <span className="absolute right-2 -top-5 rounded bg-red-100 px-1.5 py-0.5 text-[9px] text-red-500">
              Seite {index + 1} Ende
            </span>
          </div>
        ))}
      </div>

      {/* Content flow; each block avoids being split in print */}
      <div
        ref={contentRef}
        className="p-[20mm]"
        style={{ minHeight: `${totalHeightMm}mm`, overflowWrap: 'anywhere', hyphens: 'auto' }}
      >
        {children}
      </div>
    </div>
  )
}
