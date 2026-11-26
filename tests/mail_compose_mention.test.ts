// #306: "@Name" in the compose editor
import { describe, expect, it } from 'vitest'
import {
  addMentioned,
  mentionCandidates,
  mentionHtml,
  mentionQuery
} from '../src/renderer/src/components/mail/composeMention'
import { composeBody } from '../src/renderer/src/components/mail/composeBody'

const ERIKA = { name: 'Erika Musterfrau', email: 'erika@example.test' }
const MAX = { name: 'Max Beispiel', email: 'max@example.test' }

describe('mentionQuery', () => {
  it('finds the text after an @ that starts a word', () => {
    expect(mentionQuery('Und wie bei @Er')).toBe('Er')
    expect(mentionQuery('@')).toBe('')
    expect(mentionQuery('Hallo (@max')).toBe('max')
    expect(mentionQuery('Und\u00a0@Er')).toBe('Er')
  })

  it('ignores an @ inside an address and a query with a space', () => {
    expect(mentionQuery('schreib an erika@exam')).toBeNull()
    expect(mentionQuery('@Erika Muster')).toBeNull()
    expect(mentionQuery('kein at hier')).toBeNull()
  })
})

describe('mentionCandidates', () => {
  it('puts matching recipients first and lists each address once', () => {
    const list = mentionCandidates(
      'm',
      [ERIKA, MAX],
      [MAX, { name: 'Mia', email: 'mia@example.test' }]
    )
    expect(list.map((a) => a.email)).toEqual([
      'erika@example.test',
      'max@example.test',
      'mia@example.test'
    ])
  })

  it('offers every recipient for a bare @', () => {
    expect(mentionCandidates('', [ERIKA, MAX], [])).toHaveLength(2)
  })
})

describe('addMentioned', () => {
  it('adds a person who is not on the mail under An', () => {
    expect(addMentioned({ to: [ERIKA], cc: [], bcc: [] }, MAX)).toEqual({ to: [ERIKA, MAX] })
  })

  it('leaves the recipients alone when the person is already on the mail', () => {
    expect(addMentioned({ to: [ERIKA], cc: [MAX], bcc: [] }, MAX)).toBeNull()
    expect(addMentioned({ to: [], cc: [], bcc: [] }, { name: '', email: '' })).toBeNull()
    expect(
      addMentioned({ to: [ERIKA], cc: [], bcc: [] }, { name: 'E', email: 'ERIKA@example.test' })
    ).toBeNull()
  })
})

describe('mentionHtml', () => {
  it('leaves the editor as a mailto link and as "@Name" in the plain text', () => {
    const { bodyHtml, bodyText } = composeBody(`<p>Und wie bei ${mentionHtml(MAX)}?</p>`)
    expect(bodyText).toBe('Und wie bei @Max Beispiel ?')
    expect(bodyHtml).toContain('<a href="mailto:max@example.test">@Max Beispiel</a>')
    expect(bodyHtml).not.toContain('class=')
  })

  it('escapes the name', () => {
    expect(mentionHtml({ name: '<b>x</b>', email: 'x@example.test' })).toContain('@&lt;b&gt;x')
  })
})
