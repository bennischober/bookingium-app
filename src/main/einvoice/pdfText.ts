// #236: the text of a PDF (a plain invoice without e-invoice data), page by page. pdf.js runs
// in main without a worker thread; fonts are not needed for the text, so their warnings are
// silenced. Main only (the renderer has its own pdf.js for previews).

type TextItem = { str?: string; hasEOL?: boolean }

/** The PDF's text, lines kept; '' when it holds none (a scan) or cannot be read */
export async function pdfText(bytes: Uint8Array, maxPages = 5): Promise<string> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0
    })
    const pdf = await task.promise
    const pages: string[] = []
    for (let number = 1; number <= Math.min(pdf.numPages, maxPages); number++) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      pages.push(
        (content.items as TextItem[])
          .map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : ' '))
          .join('')
      )
    }
    await task.destroy()
    return pages.join('\n')
  } catch {
    return ''
  }
}
