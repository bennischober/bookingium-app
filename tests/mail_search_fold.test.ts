// MR-27: the search guards against pathological prefixes and broken MATCH expressions.
// The vocabulary is folded (unicode61 remove_diacritics 2), so the cost probe must be
// folded too; a query whose every term was dropped finds nothing; bare operators never
// reach FTS5. Invented tokens only, no mail content.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Store } from '../src/main/mailclient/core/store'
import { createMailCore, type MailCore } from '../src/main/mailclient/core/index'

const ACCOUNT = 'fold'
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-fold-'))

// 50 distinct words per prefix in every mail: with 410 mails each prefix sums to
// 20,500 doclist entries, just over the cap of 20,000
const MAILS = 410
const WORDS = 50
const verWords = Array.from({ length: WORDS }, (_, i) => `verq${i}x`)
const uebWords = Array.from({ length: WORDS }, (_, i) => `übq${i}x`)
// A rare token the guards must always let through
const RARE = 'zorblatt'

let api: MailCore

beforeAll(() => {
  const storeDir = path.join(DIR, ACCOUNT)
  fs.mkdirSync(storeDir, { recursive: true })
  const store = new Store(storeDir, ACCOUNT)
  const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
  for (let i = 0; i < MAILS; i++) {
    const body = [...verWords, ...uebWords, i % 10 === 0 ? RARE : 'plain'].join(' ')
    store.insertMessage({
      account_id: ACCOUNT,
      folder_id: inbox.id,
      uid: i + 1,
      message_key: `fold-${i}`,
      file_path: `fold-${i}.eml`,
      message_id: `<fold-${i}@example.test>`,
      in_reply_to: null,
      references_json: '[]',
      thread_id: null,
      date: '2026-10-01T12:00:00.000Z',
      internal_date: '2026-10-01T12:00:00.000Z',
      subject: `mail ${i}`,
      from_name: 'Sender',
      from_email: 'sender@example.test',
      to_json: '[]',
      cc_json: '[]',
      bcc_json: '[]',
      flags_json: '{"seen":true,"flagged":false,"draft":false,"deleted":false,"answered":false}',
      modseq: null,
      has_attachments: 0,
      attachments_json: '[]',
      size_bytes: 1000 + i,
      body_text: body,
      body_html: null,
      snippet: '',
      parsed_ok: 1,
      parse_error: null
    })
  }
  store.close()
  api = createMailCore({
    dataDir: DIR,
    accounts: [
      {
        id: ACCOUNT,
        readOnly: false,
        email: 'fold@example.test',
        host: '127.0.0.1',
        port: 1,
        security: 'none',
        credentials: async () => ({ user: 'fold@example.test', pass: 'x' })
      }
    ]
  }) as MailCore
}, 60_000)

afterAll(async () => {
  await api?.close()
  fs.rmSync(DIR, { recursive: true, force: true })
})

/** The store the core opened, for the pure guards */
const store = (): Store =>
  (api as unknown as { entries: Map<string, { store: Store }> }).entries.get(ACCOUNT)!.store

const guarded = (query: string): string =>
  store().capPathologicalPrefixes(store().ftsEscapeUserQuery(query))

describe('prefix cap folds the probe like the tokenizer (MR-27)', () => {
  it('caps a lower-case prefix over the limit', () => {
    expect(guarded('verq')).toBe('')
  })

  it('caps a capitalised prefix, as German nouns are written', () => {
    expect(guarded('Verq')).toBe('')
  })

  it('caps an all-caps prefix', () => {
    expect(guarded('VERQ')).toBe('')
  })

  it('caps an umlaut prefix, which the vocabulary holds without its diacritic', () => {
    expect(guarded('Übq')).toBe('')
    expect(guarded('übq')).toBe('')
  })

  it('folds like the tokenizer: lower case, no diacritics', () => {
    expect(Store.foldFtsTerm('Übergröße')).toBe('ubergroße')
    expect(Store.foldFtsTerm('CAFÉ')).toBe('cafe')
  })

  it('keeps the other terms when one is capped', () => {
    expect(guarded(`Verq ${RARE}`)).toBe(`"${RARE}" *`)
  })
})

describe('bare operators never reach FTS5 (MR-27)', () => {
  it('drops an operator on its own', () => {
    for (const q of ['OR', 'AND', 'NOT', 'OR AND', 'NOT NOT']) expect(guarded(q)).toBe('')
  })

  it('drops an operator at either end', () => {
    expect(guarded(`${RARE} OR`)).toBe(`"${RARE}" *`)
    expect(guarded(`AND ${RARE}`)).toBe(`"${RARE}" *`)
    expect(guarded(`${RARE} NOT`)).toBe(`"${RARE}" *`)
  })

  it('drops a leading NOT with its term, which would otherwise be searched for', () => {
    expect(guarded(`NOT plain`)).toBe('')
    expect(guarded(`NOT plain ${RARE}`)).toBe(`"${RARE}" *`)
  })

  it('keeps one operator of a run', () => {
    expect(guarded(`${RARE} OR AND plain`)).toBe(`"${RARE}" * AND "plain" *`)
  })

  it('drops the operator a capped term leaves behind', () => {
    expect(guarded(`Verq OR ${RARE}`)).toBe(`"${RARE}" *`)
    expect(guarded(`${RARE} OR Verq`)).toBe(`"${RARE}" *`)
  })

  it('drops a NOT whose term was capped instead of negating the next one', () => {
    expect(guarded(`${RARE} NOT Verq plain`)).toBe(`"${RARE}" * "plain" *`)
  })

  it('keeps a quote inside a term through the cap', () => {
    expect(store().capPathologicalPrefixes(store().ftsEscapeUserQuery('ab"cd'))).toBe('"ab""cd" *')
  })
})

describe('search through the core (MR-27)', () => {
  it('finds nothing when every term was capped, instead of every mail', async () => {
    const result = await api.search({ query: 'Verq Übq', wantFacets: true, wantSnippets: true })
    expect(result.total).toBe(0)
    expect(result.items).toEqual([])
    expect(result.facets).toEqual([])
  })

  it('finds nothing for an all-caps query whose terms were all capped', async () => {
    expect((await api.search({ query: 'VERQ' })).total).toBe(0)
  })

  it('finds nothing when every term was too short', async () => {
    expect((await api.search({ query: 'ab cd' })).total).toBe(0)
  })

  it('answers operator-only queries without throwing', async () => {
    for (const query of ['NOT', 'OR', 'AND AND', 'NOT OR']) {
      expect((await api.search({ query })).total).toBe(0)
    }
  })

  it('still answers the term next to a bare operator', async () => {
    const expected = Math.ceil(MAILS / 10)
    expect((await api.search({ query: `${RARE} OR` })).total).toBe(expected)
    expect((await api.search({ query: `NOT ${RARE} ${RARE}` })).total).toBe(expected)
  })

  it('treats a blank query as no text filter', async () => {
    expect((await api.search({ query: '   ' })).total).toBe(MAILS)
  })
})
