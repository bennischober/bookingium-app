// H4: the bullet-list button appeared to do nothing.
//
// Diagnosed in two halves:
//   - composeBody() keeps lists correctly (asserted below), so the data path is fine.
//   - jsdom has no document.execCommand, so the browser half cannot run here.
//   - the real fault was RENDERING: Tailwind's preflight sets `list-style: none` on every
//     list, so a <ul> the toolbar created had no bullets and looked like plain lines.
//
// The fix restores the bullets inside `.mail-editor` (index.css). What is testable without a
// browser is the pair: the editor really carries that class, and the stylesheet really has the
// rule. The visual result is the user's to confirm.
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { composeBody } from '@/components/mail/composeBody'

const source = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')

describe('H4: composeBody keeps a list', () => {
  it('keeps list items as separate lines in the plain text', () => {
    // The plain text is what search and snippets use; the items must not be glued together
    const { bodyText } = composeBody('<ul><li>eins</li><li>zwei</li></ul>')
    expect(bodyText.split('\n').filter((line) => line.trim())).toEqual(['eins', 'zwei'])
  })

  it('keeps the list markup in the HTML that is sent', () => {
    const { bodyHtml } = composeBody('<ul><li>eins</li><li>zwei</li></ul>')
    expect(bodyHtml).toContain('<ul>')
    expect(bodyHtml).toContain('<li>')
  })

  it('keeps an ordered list too', () => {
    const { bodyHtml, bodyText } = composeBody('<ol><li>erstens</li><li>zweitens</li></ol>')
    expect(bodyHtml).toContain('<ol>')
    expect(bodyText.split('\n').filter((line) => line.trim())).toEqual(['erstens', 'zweitens'])
  })
})

describe('H4: the editor renders its lists with bullets', () => {
  it('marks the editable as the mail editor', () => {
    // Without this class the CSS below matches nothing, which is how the bug survived
    const compose = source('src/renderer/src/components/mail/ComposeView.tsx')
    expect(compose).toMatch(/className="mail-editor[^"]*"\s*\n\s*contentEditable/)
  })

  it('restores the bullet and number styles that preflight removes', () => {
    const css = source('src/renderer/src/assets/index.css')
    // Tailwind's preflight sets list-style: none on every list, so the editor has to undo it
    expect(css).toMatch(/\.mail-editor ul\s*\{[^}]*list-style:\s*disc/)
    expect(css).toMatch(/\.mail-editor ol\s*\{[^}]*list-style:\s*decimal/)
  })
})
