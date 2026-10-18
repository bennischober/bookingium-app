import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

// A4 at CSS pixel density (96dpi): 210mm x 297mm
const A4_WIDTH_PX = (210 / 25.4) * 96
const A4_ASPECT = 297 / 210

/**
 * A4 document wrapper with a true-to-print page view.
 *
 * The document renders as a single A4-width sheet (fixed 210mm) that is the
 * print source but hidden on screen. What the user sees is the REAL print
 * output (Electron printToPDF of this window, which renders print media, so
 * the hidden sheet is what gets printed) drawn page by page with pdf.js —
 * each canvas is one genuine DIN A4 page, exact by definition. The output is
 * regenerated whenever the document content changes (data, template, images
 * loading in). If generating it fails, the plain sheet is shown instead.
 *
 * Page breaks: content flows freely across pages (no whole-section
 * avoidance, which left large gaps); headings stay with the text that
 * follows, paragraphs keep at least 3 lines on either side of a break, and
 * table rows / images / blocks marked break-inside-avoid never split.
 * @page margins mirror the sheet padding.
 */
export function PagedDocument({
  children,
  paddingMm = 20
}: {
  children: ReactNode
  paddingMm?: number
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const pdf = usePrintOutput(contentRef)
  const showSheet = pdf.status === 'error' && !pdf.data

  return (
    <>
      <style>{`
        .paged-content :is(h1, h2, h3, h4) { break-after: avoid; }
        .paged-content :is(p, li) { orphans: 3; widows: 3; }
        .paged-content :is(tr, img) { break-inside: avoid; }
        @media print {
          .paged-sheet {
            width: auto !important;
            min-height: 0 !important;
            box-shadow: none !important;
            margin: 0 !important;
          }
          /* flow-root keeps the first block's top margin (agency invoice:
             24mm) inside; without padding it would collapse out of the
             sheet and push the full-height page wrapper onto a blank 2nd page */
          .paged-content { padding: 0 !important; display: flow-root; }
          @page { size: A4; margin: ${paddingMm}mm; }
        }
        @media screen {
          .paged-source[data-screen-hidden='true'] { display: none; }
        }
      `}</style>

      {/* The document as a single A4 sheet: the print source. The wrapper
          carries the visibility flag so toggling it is not a content change
          for the observer. */}
      <div className="paged-source" data-screen-hidden={!showSheet}>
        <div
          ref={contentRef}
          className="paged-sheet relative mx-auto w-[210mm] bg-white text-black shadow-lg print:shadow-none"
          style={{ minHeight: '297mm' }}
        >
          <div
            className="paged-content"
            style={{ padding: `${paddingMm}mm`, overflowWrap: 'anywhere', hyphens: 'auto' }}
          >
            {children}
          </div>
        </div>
      </div>

      <PdfPages pdf={pdf} />
    </>
  )
}

type PrintOutput =
  | { status: 'loading'; data: Uint8Array | null }
  | { status: 'ready'; data: Uint8Array }
  | { status: 'error'; data: Uint8Array | null; error: string }

/**
 * Generates the real print output of this window and regenerates it
 * (debounced) whenever the document DOM changes or an image finishes loading.
 */
function usePrintOutput(contentRef: React.RefObject<HTMLDivElement | null>): PrintOutput {
  const [output, setOutput] = useState<PrintOutput>({ status: 'loading', data: null })

  useEffect(() => {
    const content = contentRef.current
    if (!content) return

    let run = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const generate = async () => {
      const current = ++run
      setOutput((prev) => ({ status: 'loading', data: prev.data }))
      // Wait for webfonts and every image so the PDF matches the final layout
      await document.fonts.ready
      await Promise.all(
        Array.from(content.querySelectorAll('img')).map((img) => img.decode().catch(() => {}))
      )
      if (current !== run) return
      const result = await window.api.generatePrintPreview()
      if (current !== run) return
      if (result.success && result.data) {
        setOutput({ status: 'ready', data: result.data })
      } else {
        setOutput((prev) => ({
          status: 'error',
          data: prev.data,
          error: result.error ?? 'Unbekannter Fehler'
        }))
      }
    }

    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void generate(), 300)
    }

    schedule()
    const observer = new MutationObserver(schedule)
    observer.observe(content, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true
    })
    content.addEventListener('load', schedule, true)

    return () => {
      run++
      clearTimeout(timer)
      observer.disconnect()
      content.removeEventListener('load', schedule, true)
    }
  }, [contentRef])

  return output
}

// pdf.js is loaded lazily on first use. The worker runs on the main thread
// (pdfjsWorker global): the documents are a few pages, and it avoids module
// workers from file:// and CSP worker-src issues in the packaged app.
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null
function loadPdfjs() {
  pdfjsPromise ??= (async () => {
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs')
    ;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker
    return import('pdfjs-dist')
  })()
  return pdfjsPromise
}

/** Draws each page of the print PDF as its own A4 sheet */
function PdfPages({ pdf }: { pdf: PrintOutput }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pageCount, setPageCount] = useState(0)
  const [renderError, setRenderError] = useState<string | null>(null)

  const data = pdf.data

  useEffect(() => {
    const container = containerRef.current
    if (!data || !container) return
    let cancelled = false

    void (async () => {
      try {
        const pdfjs = await loadPdfjs()
        // getDocument transfers the buffer to the worker; keep ours intact
        const doc = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false }).promise
        if (cancelled) return

        // Render offscreen first, then swap in all pages at once (no flicker)
        const canvases: HTMLCanvasElement[] = []
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i)
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({
            scale: (A4_WIDTH_PX / base.width) * Math.max(window.devicePixelRatio, 1) * 1.5
          })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.className = 'block h-auto w-[210mm] bg-white shadow-lg'
          canvas.dataset.page = String(i)
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('Canvas nicht verfügbar')
          await page.render({ canvasContext: ctx, viewport }).promise
          if (cancelled) return
          canvases.push(canvas)
        }
        void doc.destroy()
        if (cancelled) return

        // Wrap each canvas with its page label
        const nodes = canvases.map((canvas, index) => {
          const wrapper = document.createElement('div')
          wrapper.className = 'flex flex-col items-center gap-1'
          const label = document.createElement('div')
          label.className = 'text-xs text-neutral-500'
          label.textContent = `Seite ${index + 1} von ${canvases.length}`
          wrapper.append(canvas, label)
          return wrapper
        })
        container.replaceChildren(...nodes)
        setPageCount(canvases.length)
        setRenderError(null)
      } catch (error) {
        if (!cancelled) setRenderError(error instanceof Error ? error.message : String(error))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [data])

  const error = pdf.status === 'error' ? pdf.error : renderError

  return (
    <div className="mx-auto w-[210mm] print:hidden" data-testid="print-pages">
      <div className="mb-2 flex h-5 items-center justify-center gap-2 text-xs text-neutral-600">
        {pdf.status === 'loading' && (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            {data ? 'Seitenansicht wird aktualisiert…' : 'Seitenansicht wird erstellt…'}
          </>
        )}
        {pdf.status !== 'loading' && !error && pageCount > 0 && (
          <>
            DIN A4 · {pageCount} {pageCount === 1 ? 'Seite' : 'Seiten'} — entspricht dem Ausdruck
          </>
        )}
        {error && <span className="text-red-600">Seitenansicht fehlgeschlagen: {error}</span>}
      </div>
      {!data && (
        <div
          className="mx-auto w-[210mm] bg-white shadow-lg"
          style={{ height: `${A4_WIDTH_PX * A4_ASPECT}px` }}
        />
      )}
      <div ref={containerRef} className="flex flex-col items-center gap-6" />
    </div>
  )
}
