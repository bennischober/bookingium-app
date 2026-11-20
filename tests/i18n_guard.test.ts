import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { EN } from '../src/main/i18n/en'
import { placeholders } from '../src/main/i18n/translate'
import { AVOIDED_WORDS_EN } from '../src/main/api/terms'

// #254: every German source string passed to t() has an English entry in src/main/i18n/en.ts,
// every entry is still used, and key and translation name the same {{placeholders}}.

const ROOT = join(__dirname, '..')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(path, out)
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(path)
  }
  return out
}

/** The literal strings a t() argument can be: a literal, or either branch of a ternary */
function literals(node: ts.Expression): string[] | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text]
  if (ts.isParenthesizedExpression(node)) return literals(node.expression)
  if (ts.isConditionalExpression(node)) {
    const a = literals(node.whenTrue)
    const b = literals(node.whenFalse)
    return a && b ? [...a, ...b] : null
  }
  return null
}

type Call = { key: string; at: string }

/** Every t('…') call under src/, and the calls whose argument is not a literal */
function translateCalls(): { calls: Call[]; dynamic: string[] } {
  const calls: Call[] = []
  const dynamic: string[] = []
  for (const path of sourceFiles(join(ROOT, 'src'))) {
    const code = readFileSync(path, 'utf8')
    if (!code.includes('i18n/translate')) continue
    const file = relative(ROOT, path).split(sep).join('/')
    const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, kind)
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 't' &&
        node.arguments.length > 0
      ) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart())
        const at = `${file}:${line + 1}`
        const keys = literals(node.arguments[0])
        if (keys) calls.push(...keys.map((key) => ({ key, at })))
        else dynamic.push(at)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return { calls, dynamic }
}

const { calls, dynamic } = translateCalls()

describe('i18n guard', () => {
  it('passes only literal German strings to t()', () => {
    expect(dynamic, 't() needs the German text itself, so this test can check it').toEqual([])
  })

  it('has an English entry for every t() string', () => {
    const missing = calls.filter(({ key }) => !(key in EN)).map(({ key, at }) => `${at} "${key}"`)
    expect(missing, 'Add the English text to src/main/i18n/en.ts').toEqual([])
  })

  it('has no English entry that no code uses', () => {
    const used = new Set(calls.map(({ key }) => key))
    expect(Object.keys(EN).filter((key) => !used.has(key))).toEqual([])
  })

  it('keeps the placeholders of each string', () => {
    const differing = Object.entries(EN)
      .filter(([key, text]) => placeholders(key).join() !== placeholders(text).join())
      .map(([key, text]) => `"${key}" -> "${text}"`)
    expect(differing).toEqual([])
  })

  it('finds no avoided word in the English texts', () => {
    const word = new RegExp(
      String.raw`(?<![\p{L}\p{N}_])(${Object.keys(AVOIDED_WORDS_EN).join('|')})(?![\p{L}\p{N}_])`,
      'gu'
    )
    const found = Object.values(EN).flatMap((text) =>
      [...text.matchAll(word)].map(([, w]) => `"${text}": "${w}" - write "${AVOIDED_WORDS_EN[w]}"`)
    )
    expect(found, 'Use the term from TERMS_EN in src/main/api/terms.ts').toEqual([])
  })
})
