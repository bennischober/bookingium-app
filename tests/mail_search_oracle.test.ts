// A8: independent-oracle regression for search, ported from the prototype's
// test-search-oracle. The generator KNOWS which synthetic message carries which token in
// which field, so every expectation (hit sets, per-folder counts, filters, ordering) is
// computed in JS, independent of the SQL/FTS path under test. No real mail content.
//
// 2,000 messages by default; set MAIL_LONG=1 for the 30,000-message run.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { Store } from '../src/main/mailclient/core/store'

const LONG = process.env.MAIL_LONG === '1'
const N = LONG ? 30_000 : 2_000

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-oracle-'))

/** Deterministic PRNG so a failure reproduces run to run */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Invented tokens (>= MIN_FTS_TERM_LEN, never real words, never mail content)
const TOKENS = [
  'zorblatt',
  'quixalbe',
  'fremdax',
  'wobbelin',
  'kravonix',
  'tulmeno',
  'bastrik',
  'velondo',
  'grimsby',
  'xantopa',
  'mirdwell',
  'lopanie',
  'chervok',
  'dunthor',
  'elquiss',
  'fraxima',
  'golband',
  'hilmoro',
  'javrik',
  'kelpwist',
  'lumbrax',
  'mondril',
  'novaxel',
  'oprigan',
  'platumo',
  'quorvex'
]

const CRAFT_TOKEN = 'velugax'
const baseMs = Date.parse('2026-10-01T12:00:00.000Z')

type Meta = {
  id: number
  folderId: string
  subjTokens: Set<string>
  bodyTokens: Set<string>
  senderIdx: number
  hasAtt: boolean
  date: string
}

const store = new Store(DIR, 'oracle')
const rnd = mulberry32(0x0a2b1c3d)
void rnd

const folderIds = [
  store.upsertFolder({ imapPath: 'OracleA', delimiter: '/', uidValidity: '9001' }),
  store.upsertFolder({ imapPath: 'OracleB', delimiter: '/', uidValidity: '9002' }),
  store.upsertFolder({ imapPath: 'OracleC', delimiter: '/', uidValidity: '9003' })
].map((f) => f.id)
const craftFolderId = store.upsertFolder({
  imapPath: 'OracleCraft',
  delimiter: '/',
  uidValidity: '9004'
}).id

const meta: Meta[] = []

/** Generates the corpus. Insertion order == date-desc order, so paging is total. */
function generate(count: number): void {
  const BATCH = 1000
  for (let i = 0; i < count; i += BATCH) {
    const tx = store.db.transaction(() => {
      for (let j = i; j < Math.min(i + BATCH, count); j++) {
        const folderId = folderIds[j % 7 === 0 ? 1 : j % 11 === 0 ? 2 : 0]
        const subjTokens = new Set<string>([TOKENS[j % TOKENS.length]])
        const bodyTokens = new Set<string>([TOKENS[(j * 7 + 3) % TOKENS.length]])
        const senderIdx = j % 40
        const hasAtt = j % 9 === 0
        const date = new Date(baseMs - j * 1000).toISOString()
        const sender = `sender${senderIdx}`
        // Extra scatter tokens are recorded, because the oracle must know them
        const extraSubj = j % 97 === 0 ? TOKENS[(j + 13) % TOKENS.length] : null
        const subject = `msg ${j} ${[...subjTokens].join(' ')}` + (extraSubj ? ` ${extraSubj}` : '')
        if (extraSubj) subjTokens.add(extraSubj)
        const extraBody = j % 23 === 0 ? TOKENS[(j + 5) % TOKENS.length] : null
        const body =
          [`report ${j}`, ...bodyTokens, ...(j % 5 === 0 ? subjTokens : [])].join(' ') +
          (extraBody ? ` ${extraBody}` : '')
        if (extraBody) bodyTokens.add(extraBody)
        const id = store.insertMessage({
          account_id: 'oracle',
          folder_id: folderId,
          uid: j + 1,
          message_key: `oracle-${j}`,
          file_path: `oracle-${j}.eml`,
          message_id: `<oracle-${j}@test>`,
          in_reply_to: null,
          references_json: '[]',
          thread_id: null,
          date,
          internal_date: date,
          subject,
          from_name: `Sender ${senderIdx}`,
          from_email: `${sender}@example.test`,
          to_json: '[{"name":"","email":"oracle@example.test"}]',
          cc_json: '[]',
          bcc_json: '[]',
          flags_json:
            '{"seen":false,"flagged":false,"draft":false,"deleted":false,"answered":false}',
          modseq: String(j + 1),
          has_attachments: hasAtt ? 1 : 0,
          attachments_json: hasAtt
            ? '[{"partId":"1","filename":"a.pdf","contentType":"application/pdf","size":10,"isInline":false,"contentId":null}]'
            : '[]',
          size_bytes: 1000 + j,
          body_text: body,
          body_html: null,
          snippet: body.slice(0, 60),
          parsed_ok: 1,
          parse_error: null
        })
        meta.push({ id, folderId, subjTokens, bodyTokens, senderIdx, hasAtt, date })
      }
    })
    tx()
  }
}

generate(N)

/** Independent JS oracle: a token hits a mail when it is in the subject or the body */
const hits = (tok: string): number[] =>
  meta.filter((m) => m.subjTokens.has(tok) || m.bodyTokens.has(tok)).map((m) => m.id)

const hitsBoth = (a: string, b: string): number[] => {
  const sa = new Set(hits(a))
  return hits(b).filter((id) => sa.has(id))
}

const idSet = (rows: { id: number }[]): Set<number> => new Set(rows.map((r) => r.id))

afterAll(() => {
  store.close()
  fs.rmSync(DIR, { recursive: true, force: true })
})

describe(`search oracle (${N} synthetic messages)`, () => {
  it('reports the generated corpus size', () => {
    const total = (store.db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c
    expect(total).toBe(N)
  })

  it('single-term hit sets match the oracle', () => {
    for (const [label, tok] of [
      ['mid-frequency', 'mirdwell'],
      ['low-frequency', 'xantopa']
    ] as const) {
      const expected = hits(tok)
      const r = store.search({ matchExpr: store.ftsEscapeUserQuery(tok), limit: 50, offset: 0 })
      expect(r.total, `${label} ${tok}`).toBe(expected.length)
      const expSet = new Set(expected)
      for (const id of idSet(r.rows)) expect(expSet.has(id), `${label} page row ${id}`).toBe(true)
    }
  })

  it('multi-term is an implicit AND, and paging has no gaps or duplicates', () => {
    const a = TOKENS[4]
    const b = TOKENS[11]
    const expected = hitsBoth(a, b)
    const r = store.search({
      matchExpr: store.ftsEscapeUserQuery(`${a} ${b}`),
      limit: 50,
      offset: 0
    })
    expect(r.total).toBe(expected.length)

    const union = new Set<number>()
    let dupes = 0
    for (let off = 0; off < r.total; off += 50) {
      const p = store.search({
        matchExpr: store.ftsEscapeUserQuery(`${a} ${b}`),
        limit: 50,
        offset: off
      })
      for (const row of p.rows) {
        if (union.has(row.id)) dupes++
        union.add(row.id)
      }
    }
    const expSet = new Set(expected)
    const missing = [...expSet].filter((id) => !union.has(id))
    expect(dupes).toBe(0)
    expect(missing).toEqual([])
    expect(union.size).toBe(expected.length)
  })

  it('filters intersect the term correctly', () => {
    const tok = TOKENS[7]
    const ftsHits = new Set(hits(tok))
    const match = (m: Meta): boolean => ftsHits.has(m.id)

    // from
    const senderIdx = 13
    const expectedFrom = meta.filter((m) => m.senderIdx === senderIdx && match(m)).length
    expect(
      store.search({
        matchExpr: store.ftsEscapeUserQuery(tok),
        from: `sender${senderIdx}`,
        limit: 50,
        offset: 0
      }).total
    ).toBe(expectedFrom)

    // subject
    const expectedSubj = meta.filter((m) => m.subjTokens.has(tok)).length
    expect(
      store.search({ matchExpr: store.ftsEscapeUserQuery(tok), subject: tok, limit: 50, offset: 0 })
        .total
    ).toBe(expectedSubj)

    // hasAttachment
    const expectedAtt = meta.filter((m) => m.hasAtt && match(m)).length
    expect(
      store.search({
        matchExpr: store.ftsEscapeUserQuery(tok),
        hasAttachment: true,
        limit: 50,
        offset: 0
      }).total
    ).toBe(expectedAtt)

    // date window
    const after = new Date(baseMs - 60 * 24 * 3600 * 1000).toISOString()
    const expectedDate = meta.filter((m) => m.date >= after && match(m)).length
    expect(
      store.search({ matchExpr: store.ftsEscapeUserQuery(tok), after, limit: 50, offset: 0 }).total
    ).toBe(expectedDate)

    // folder + hasAttachment + term
    const fB = folderIds[1]
    const expectedCombo = meta.filter((m) => m.folderId === fB && m.hasAtt && match(m)).length
    expect(
      store.search({
        matchExpr: store.ftsEscapeUserQuery(tok),
        folderId: fB,
        hasAttachment: true,
        limit: 50,
        offset: 0
      }).total
    ).toBe(expectedCombo)

    // facets per folder
    const facets = store.searchFacets({ matchExpr: store.ftsEscapeUserQuery(tok) })
    for (const fid of folderIds) {
      const expected = meta.filter((m) => m.folderId === fid && match(m)).length
      expect(facets.find((f) => f.folderId === fid)?.count ?? 0, `facet ${fid}`).toBe(expected)
    }
  })

  it('ranks subject hits above body-only hits', () => {
    const ids: number[] = []
    const rows = [
      {
        tag: 'sb',
        subject: `craft alpha ${CRAFT_TOKEN}`,
        body: `body beta gamma delta ${CRAFT_TOKEN}`
      },
      { tag: 's', subject: `craft alpha ${CRAFT_TOKEN}`, body: 'body beta gamma delta epsilon' },
      {
        tag: 'b',
        subject: 'craft alpha zeta eta theta',
        body: `body beta gamma delta ${CRAFT_TOKEN}`
      }
    ]
    for (const r of rows) {
      ids.push(
        store.insertMessage({
          account_id: 'oracle',
          folder_id: craftFolderId,
          uid: 900000 + ids.length,
          message_key: `craft-${r.tag}`,
          file_path: `craft-${r.tag}.eml`,
          message_id: `<craft-${r.tag}@test>`,
          in_reply_to: null,
          references_json: '[]',
          thread_id: null,
          date: '2026-09-15T00:00:00.000Z',
          internal_date: '2026-09-15T00:00:00.000Z',
          subject: r.subject,
          from_name: 'Craft',
          from_email: 'craft@example.test',
          to_json: '[]',
          cc_json: '[]',
          bcc_json: '[]',
          flags_json:
            '{"seen":false,"flagged":false,"draft":false,"deleted":false,"answered":false}',
          modseq: '1',
          has_attachments: 0,
          attachments_json: '[]',
          size_bytes: 500,
          body_text: r.body,
          body_html: null,
          snippet: r.body.slice(0, 30),
          parsed_ok: 1,
          parse_error: null
        })
      )
    }

    const r = store.search({
      matchExpr: store.ftsEscapeUserQuery(CRAFT_TOKEN),
      sortBy: 'relevance',
      limit: 50,
      offset: 0
    })
    const order = r.rows.map((x) => x.id)
    const iSb = order.indexOf(ids[0])
    const iS = order.indexOf(ids[1])
    const iB = order.indexOf(ids[2])

    expect(iSb, 'subject+body present').toBeGreaterThanOrEqual(0)
    expect(iS, 'subject-only present').toBeGreaterThanOrEqual(0)
    expect(iB, 'body-only present').toBeGreaterThanOrEqual(0)
    expect(iSb).toBeLessThan(iS)
    expect(iS).toBeLessThan(iB)
  })

  it('walks a folder in exact date order with no duplicates or gaps', () => {
    const fid = folderIds[0]
    const folderRows = meta.filter((m) => m.folderId === fid)
    const first = store.search({ matchExpr: null, folderId: fid, limit: 500, offset: 0 })
    expect(first.total).toBe(folderRows.length)

    const walked: number[] = []
    for (let off = 0; off < first.total; off += 500) {
      const p = store.search({ matchExpr: null, folderId: fid, limit: 500, offset: off })
      walked.push(...p.rows.map((x) => x.id))
    }
    expect(new Set(walked).size).toBe(walked.length)
    expect(walked).toEqual(folderRows.map((m) => m.id))
  })

  it('walks the global date path newest first', () => {
    const g = store.search({ matchExpr: null, limit: 100, offset: 0 })
    expect(g.total).toBe(N + 3)
    expect(g.rows.map((r) => r.id)).toEqual(meta.slice(0, 100).map((m) => m.id))
  })

  it('returns nothing for a nonexistent term and keeps the index intact', () => {
    const r = store.search({
      matchExpr: store.ftsEscapeUserQuery('zzznope-nonexistent'),
      limit: 50,
      offset: 0
    })
    expect(r.total).toBe(0)
    expect(r.rows).toEqual([])
    expect(store.ftsIntegrityCheck()).toBe(true)
  })
})

// F1: the two guards that keep a user's search text from breaking or blocking
// the FTS5 query. Both are pure, so their rules are pinned directly.
describe('FTS5 query guards (F1)', () => {
  it('turns every user term into a quoted prefix', () => {
    expect(store.ftsEscapeUserQuery('rechnung')).toBe('"rechnung" *')
    expect(store.ftsEscapeUserQuery('zwei worte')).toBe('"zwei" * "worte" *')
  })

  it('quotes a quote instead of letting it end the term', () => {
    // A raw " would end the FTS5 string and let the rest of the query through
    expect(store.ftsEscapeUserQuery('a"b')).toBe('"a""b" *')
  })

  it('strips the FTS5 operators out of a user term', () => {
    for (const raw of ['a*b', 'a(b)', 'a{b}', 'a:b', 'a^b', 'a-b']) {
      const escaped = store.ftsEscapeUserQuery(raw)
      // Every operator is gone from the term itself, so it can only match text
      expect(escaped.replace(/[*(){}:^-]/g, '')).not.toMatch(/[*(){}:^-]/)
    }
  })

  it('drops terms that are too short, which FTS5 cannot prefix cheaply', () => {
    // MIN_FTS_TERM_LEN is 3: a 2-character prefix matches a large share of the corpus
    expect(store.ftsEscapeUserQuery('ab')).toBe('')
    expect(store.ftsEscapeUserQuery('abc')).toBe('"abc" *')
  })

  it('keeps the boolean keywords a user may type', () => {
    expect(store.ftsEscapeUserQuery('rechnung OR mahnung')).toBe('"rechnung" * OR "mahnung" *')
  })

  it('returns nothing for a query that is only punctuation', () => {
    expect(store.ftsEscapeUserQuery('***')).toBe('')
    expect(store.ftsEscapeUserQuery('   ')).toBe('')
  })

  it('keeps a prefix whose doclist is small enough to answer', () => {
    // A rare token: the exact-cost probe counts its docs and lets it through
    expect(store.capPathologicalPrefixes('"xantopa" *')).toBe('"xantopa" *')
  })

  it('drops a prefix whose doclist would block the search', () => {
    // The probe counts the doclist through fts_vocab, so the corpus has to be
    // big enough: 2000 mails sharing one word push it past MAX_PREFIX_DOCS
    const common = 'verfahrensdokumentation'
    const tx = store.db.transaction(() => {
      for (let i = 0; i < 21_000; i++) {
        store.insertMessage({
          account_id: 'oracle',
          folder_id: folderIds[0],
          uid: 900_000 + i,
          message_key: `cap-${i}`,
          file_path: `cap-${i}.eml`,
          message_id: `<cap-${i}@test>`,
          in_reply_to: null,
          references_json: '[]',
          thread_id: null,
          date: new Date().toISOString(),
          internal_date: null,
          subject: common,
          from_name: 'Cap',
          from_email: 'cap@example.test',
          to_json: '[{"name":"","email":"oracle@example.test"}]',
          cc_json: '[]',
          bcc_json: '[]',
          flags_json: '{}',
          modseq: null,
          has_attachments: 0,
          attachments_json: '[]',
          size_bytes: 10,
          body_text: common,
          body_html: null,
          snippet: common,
          parsed_ok: 1,
          parse_error: null
        })
      }
    })
    tx()

    // Over the limit: the term is dropped, and the safe one still answers
    expect(store.capPathologicalPrefixes(`"${common}" * "xantopa" *`)).toBe('"xantopa" *')
    // Over the limit on its own too: nothing is left to search
    expect(store.capPathologicalPrefixes(`"${common}" *`)).toBe('')
  }, 30_000)
})
