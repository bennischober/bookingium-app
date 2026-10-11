import { useEffect, useRef, useState, type ReactNode } from 'react'

// A4 page geometry (DIN A4: 210 x 297 mm)
const PAGE_W_MM = 210
const PAGE_H_MM = 297
const COLUMN_GAP_MM = 8

/**
 * A4 page preview via CSS multi-column fragmentation.
 *
 * Chromium fragments the content into page-height columns using its layout
 * engine — the screen shows the content as successive A4 pages, honoring
 * break-inside: avoid, with no JS measurement and no DOM surgery.
 *
 * Screen: pages sit side by side in a snap-scrolling strip, like a document
 * viewer. Print: normal block flow with the same break-inside rules; the
 * page margin comes from the print stylesheet's @page rule, which mirrors
 * the preview padding.
 *
 * Note: the print engine (paged media) and the on-screen column engine are
 * close but not identical in edge cases (margins between blocks, widows) —
 * the preview can drift by up to ~one page on long documents. The printed
 * result itself is always clean (no cut words, no split sections).
 */
export function PagedDocument({
  children,
  paddingMm = 20
}: {
  children: ReactNode
  paddingMm?: number
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [pageCount, setPageCount] = useState(1)

  // Fragment count = total flow width / (page width + gap)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const update = () => {
      const step = host.clientWidth + COLUMN_GAP_MM * 3.7795 // mm gap -> px
      if (step <= 0) return
      const count = Math.max(1, Math.round(host.scrollWidth / step))
      setPageCount(count)
    }

    void document.fonts.ready.then(update)
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="relative print:m-0">
      <style>{`
        .paged-host {
          column-width: ${PAGE_W_MM}mm;
          column-gap: ${COLUMN_GAP_MM}mm;
          column-fill: auto;
          height: ${PAGE_H_MM}mm;
          padding: ${paddingMm}mm;
          box-sizing: border-box;
          overflow-wrap: anywhere;
          hyphens: auto;
        }
        .paged-host > * {
          break-inside: avoid;
        }
        .paged-host::-webkit-scrollbar { height: 10px; }
        .paged-host::-webkit-scrollbar-thumb { background: rgb(0 0 0 / 0.25); border-radius: 5px; }
        @media print {
          .paged-host {
            height: auto;
            column-width: auto;
            column-gap: 0;
            padding: 0;
            overflow: visible;
          }
          .paged-host > * { break-inside: avoid; }
        }
      `}</style>

      <div ref={hostRef} className="paged-host bg-white text-black shadow-lg print:shadow-none">
        {children}
      </div>

      <p className="mt-2 text-center text-xs text-muted-foreground print:hidden">
        {pageCount} {pageCount === 1 ? 'Seite' : 'Seiten'} · Die Umbrüche im Druck können leicht
        abweichen
      </p>
    </div>
  )
}
