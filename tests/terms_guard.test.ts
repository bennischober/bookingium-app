import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { AVOIDED_WORDS } from '../src/main/api/terms'

// #105: UI strings use the terms of src/main/api/terms.ts, not a competing word.
// Scans string literals, template text and JSX text under src/ (not comments,
// not identifiers) for the whole words in AVOIDED_WORDS.

const ROOT = join(__dirname, '..')

/** Legal text of the printed contracts, worded as a whole, not UI copy */
const LEGAL_TEXT = new Set([
  'src/renderer/src/components/contract/ContractDocument.tsx',
  'src/renderer/src/components/contract/ManagementContractDocument.tsx'
])

/**
 * Uses that are still there, file -> word -> count. Rewording one is a visible
 * change, so each goes in its own PR; the test then asks to lower the count
 * here. Never add to this list: write the term instead.
 */
const KNOWN: Record<string, Record<string, number>> = {
  'src/main/mail/contractEmail.ts': { Konzertvertrag: 1 },
  'src/main/repositories/VenueRepository.ts': { Venue: 1 },
  'src/renderer/src/components/event-hub/ItineraryTab.tsx': { Venue: 2 },
  'src/renderer/src/components/forms/BandForm.tsx': { Konzertverträgen: 1 },
  'src/renderer/src/components/invoice/AgencyInvoiceTemplate.tsx': { Künstler: 1 },
  'src/renderer/src/components/invoice/StandardInvoiceTemplate.tsx': { Künstler: 1 },
  'src/renderer/src/components/settings/MapPreviewSwitchCard.tsx': { Veranstaltung: 2 },
  'src/renderer/src/components/ui/search-command-button.tsx': { Gigs: 1 },
  'src/renderer/src/pages/BandPage.tsx': { Künstler: 1 },
  'src/renderer/src/pages/ContractPrintPage.tsx': { Konzertvertrag: 1 },
  'src/renderer/src/pages/DashboardPage.tsx': { Gigs: 2 }
}

const WORD = new RegExp(
  String.raw`(?<![\p{L}\p{N}_])(${Object.keys(AVOIDED_WORDS).join('|')})(?![\p{L}\p{N}_])`,
  'gu'
)

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(path, out)
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(path)
  }
  return out
}

/** The UI text of one file: string literals, template text, JSX text */
function texts(file: string): { text: string; line: number }[] {
  const code = readFileSync(file, 'utf8')
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind)
  const found: { text: string; line: number }[] = []
  const visit = (node: ts.Node): void => {
    const isText =
      (ts.isStringLiteral(node) &&
        !ts.isImportDeclaration(node.parent) &&
        !ts.isExportDeclaration(node.parent)) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    if (isText) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart())
      found.push({ text: (node as ts.LiteralLikeNode).text, line: line + 1 })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('terms guard', () => {
  it('finds no avoided word in UI strings beyond the known uses', () => {
    const counts: Record<string, Record<string, number>> = {}
    const fresh: string[] = []
    for (const path of sourceFiles(join(ROOT, 'src'))) {
      const file = relative(ROOT, path).split(sep).join('/')
      if (file === 'src/main/api/terms.ts' || LEGAL_TEXT.has(file)) continue
      for (const { text, line } of texts(path)) {
        for (const [, word] of text.matchAll(WORD)) {
          const perFile = (counts[file] ??= {})
          perFile[word] = (perFile[word] ?? 0) + 1
          if (perFile[word] > (KNOWN[file]?.[word] ?? 0)) {
            fresh.push(`${file}:${line} "${word}" - write "${AVOIDED_WORDS[word]}"`)
          }
        }
      }
    }
    expect(fresh, 'Use the term from src/main/api/terms.ts').toEqual([])
    // A known use was reworded: lower its count in KNOWN
    expect(counts).toEqual(KNOWN)
  })
})
