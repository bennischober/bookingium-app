import { useEffect, useRef, type ReactNode } from 'react'
import { FileQuestion } from 'lucide-react'

/**
 * A4 document wrapper with a true-to-print PDF preview.
 *
 * The document itself renders as a single vertical A4-width sheet (fixed
 * 210mm, centered) — clean and simple on screen. Section blocks carry
 * break-inside: avoid, so the print engine never splits a section across
 * pages or cuts a word at the page edge; @page margins mirror the sheet
 * padding.
 *
 * The "how will this print?" question is answered by the exact preview:
 * an optional inline viewer that renders the REAL print output (Electron
 * printToPDF via IPC) — Chromium's PDF viewer shows the genuine pages,
 * so the preview is exact by definition (it IS the print result).
 */
export function PagedDocument({
  children,
  paddingMm = 20,
  previewPdfUrl
}: {
  children: ReactNode
  paddingMm?: number
  /** data: or file: URL of the real generated PDF (printToPDF output) */
  previewPdfUrl?: string | null
}) {
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    for (const child of Array.from(content.children)) {
      if (child instanceof HTMLElement) {
        child.style.breakInside = 'avoid'
      }
    }
  })

  return (
    <>
      <style>{`
        @media print {
          .paged-sheet {
            width: auto !important;
            min-height: 0 !important;
            box-shadow: none !important;
            margin: 0 !important;
          }
          .paged-content { padding: 0 !important; }
          @page { size: A4; margin: ${paddingMm}mm; }
        }
      `}</style>

      {/* The document as a single vertical A4 sheet */}
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

      {/* Exact print preview: the real generated PDF, embedded */}
      {previewPdfUrl && (
        <div className="mx-auto mt-6 w-[210mm] print:hidden">
          <p className="mb-2 text-center text-xs text-muted-foreground">
            Exakte Druckvorschau (echtes PDF):
          </p>
          <iframe
            src={previewPdfUrl}
            title="Druckvorschau"
            className="h-[800px] w-full rounded-lg border bg-white"
          />
        </div>
      )}
    </>
  )
}

export function PdfPreviewPlaceholder() {
  return (
    <div className="mx-auto mt-6 w-[210mm] print:hidden">
      <div className="flex h-32 items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground">
        <FileQuestion className="h-4 w-4" />
        Vorschau wird erstellt…
      </div>
    </div>
  )
}
