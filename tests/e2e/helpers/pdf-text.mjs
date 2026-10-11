// Extracts text from a PDF to diagnose whether content exists.
import fs from 'fs'

async function main() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(fs.readFileSync(process.argv[2]))
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise
  console.log('pages:', doc.numPages)
  for (let i = 1; i <= Math.min(3, doc.numPages); i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => item.str)
      .join(' ')
      .slice(0, 300)
    console.log(`--- page ${i} text (${content.items.length} items):`, text || '(EMPTY)')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
