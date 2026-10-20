// Checks the e-invoice PDFs written by the e2e test (npx playwright test
// tests/e2e/einvoice.spec.ts -> tests/e2e/__screenshots__/einvoice-*.pdf)
// with veraPDF, the PDF/A reference validator, as PDF/A-3b. Needs Java and
// a veraPDF install, so it only runs when pointed at it:
//   VERAPDF=…/verapdf/verapdf.bat (or …/verapdf on Linux/macOS)
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { join, resolve } from 'path'

const verapdf = process.env.VERAPDF
const dir = resolve(__dirname, 'e2e/__screenshots__')
const pdfs = existsSync(dir)
  ? readdirSync(dir)
      .filter((file) => /^einvoice-.*\.pdf$/.test(file))
      .map((file) => join(dir, file))
  : []

describe.skipIf(!verapdf || pdfs.length === 0)('veraPDF', () => {
  it('finds the e-invoice PDFs PDF/A-3b compliant', () => {
    const run = (file: string) => {
      try {
        return execFileSync(verapdf!, ['--flavour', '3b', '--format', 'mrr', file], {
          encoding: 'utf-8',
          shell: process.platform === 'win32',
          stdio: ['pipe', 'pipe', 'pipe']
        })
      } catch (error) {
        // Exit code 1 for non-compliant files; the report is still on stdout
        return (error as { stdout?: string }).stdout ?? ''
      }
    }
    for (const file of pdfs) {
      const report = run(file)
      const failed = [...report.matchAll(/<rule [^>]*clause="([^"]+)"[^>]*status="failed"/g)]
      expect(
        failed.map((match) => match[1]),
        file
      ).toEqual([])
      expect(report, file).toContain('isCompliant="true"')
    }
  }, 120_000)
})
