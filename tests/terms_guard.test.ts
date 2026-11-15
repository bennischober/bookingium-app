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
  it('finds no avoided word in UI strings', () => {
    const found: string[] = []
    for (const path of sourceFiles(join(ROOT, 'src'))) {
      const file = relative(ROOT, path).split(sep).join('/')
      if (file === 'src/main/api/terms.ts' || LEGAL_TEXT.has(file)) continue
      for (const { text, line } of texts(path)) {
        for (const [, word] of text.matchAll(WORD)) {
          found.push(`${file}:${line} "${word}" - write "${AVOIDED_WORDS[word]}"`)
        }
      }
    }
    expect(found, 'Use the term from src/main/api/terms.ts').toEqual([])
  })
})
