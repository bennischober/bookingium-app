// Renders each page of a PDF to PNG using pdfjs-dist (ESM in v4+).
// Usage: node pdf2png.mjs <in.pdf> <outdir>
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

async function main() {
  const [, , inPath, outDir] = process.argv
  if (!inPath || !outDir) {
    console.error('usage: node pdf2png.mjs <in.pdf> <outdir>')
    process.exit(1)
  }

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const canvasModule = require('canvas')

  const data = new Uint8Array(fs.readFileSync(inPath))
  // printToPDF references the PDF standard fonts (Helvetica etc.) without
  // embedding them; pdf.js needs the shipped standard font data to draw them
  const standardFontDataUrl = path.resolve(
    path.dirname(require.resolve('pdfjs-dist/package.json')),
    'standard_fonts/'
  )
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: false,
    standardFontDataUrl: standardFontDataUrl + path.sep
  }).promise
  console.log('pages:', doc.numPages)

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    // ~144 dpi keeps PNGs readable but small
    const scale = 2
    const viewport = page.getViewport({ scale })
    const canvas = canvasModule.createCanvas(viewport.width, viewport.height)
    const ctx = canvas.getContext('2d')
    // pdf.js renders transparent backgrounds; without a white fill the PNG
    // may appear blank in some viewers
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    const out = path.join(outDir, `page-${String(i).padStart(2, '0')}.png`)
    fs.writeFileSync(out, canvas.toBuffer('image/png'))
    console.log('wrote', out)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
