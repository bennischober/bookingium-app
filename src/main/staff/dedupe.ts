// ========================================
// Contacts an employee creates twice (#262)
// ========================================
// The employee only sees the contacts shared with them, so they may create one the company
// already has. After their changes are taken over, the bridge looks at the persons, companies and
// clubs/festivals they created or changed: when exactly one record of the company is the same
// (same e-mail or VAT id, or same name without differing e-mails), the employee's record is
// merged into it (#249: the company's values stay, empty fields are filled, links move over) and
// that record is shared with the employee. The bridge then sends the employee the record and
// takes back their copy, so nobody keeps a duplicate.
//
// Bands are left alone: sharing a band shares its booking work, which needs an admin's decision.
import type { MergeCandidateDto, MergeInput, MergeKind } from '../api/schemas/merge.schema'
import { quoteIdent as q, type Sqlite } from '../sync/store'
import { isOwnKey, type StaffContext } from './policy'

/** A row the employee's batch touched */
export type TouchedRow = { table: string; key: string }

export type DuplicateMerger = {
  candidates: (kind: MergeKind, id: number) => MergeCandidateDto[]
  merge: (input: MergeInput) => number
  /** Shares the kept record with the employee */
  share: (kind: MergeKind, id: number) => void
}

type ContactKind = Exclude<MergeKind, 'band'>
const KINDS: readonly ContactKind[] = ['person', 'company', 'venue']

/** Tables whose changes can make a duplicate visible: the records and their phone/mail */
export const DEDUPE_TABLES: ReadonlySet<string> = new Set([...KINDS, 'contact', 'contact_email'])

function emailsOf(sqlite: Sqlite, table: ContactKind, id: number): string[] {
  return (
    sqlite
      .prepare(
        `SELECT lower(trim(c.email)) AS email FROM ${q(table)} r JOIN contact c ON c.id = r.contact_id WHERE r.id = ? AND c.email IS NOT NULL
         UNION SELECT lower(trim(e.email)) FROM ${q(table)} r JOIN contact_email e ON e.contact_id = r.contact_id WHERE r.id = ?`
      )
      .all(id, id) as Array<{ email: string }>
  )
    .map((row) => row.email)
    .filter(Boolean)
}

/** The employee's own records behind the touched rows */
function ownRecords(
  sqlite: Sqlite,
  ctx: StaffContext,
  touched: TouchedRow[]
): Array<[ContactKind, number]> {
  const found = new Map<string, [ContactKind, number]>()
  const add = (kind: ContactKind, id: number) => {
    if (isOwnKey(ctx, id)) found.set(`${kind}:${id}`, [kind, id])
  }
  const byContact = (contactId: unknown) => {
    if (contactId == null) return
    for (const kind of KINDS) {
      const rows = sqlite
        .prepare(`SELECT id FROM ${q(kind)} WHERE contact_id = ?`)
        .all(contactId) as Array<{ id: number }>
      for (const row of rows) add(kind, row.id)
    }
  }
  for (const { table, key } of touched) {
    if ((KINDS as readonly string[]).includes(table)) add(table as ContactKind, Number(key))
    else if (table === 'contact') byContact(Number(key))
    else if (table === 'contact_email') {
      const row = sqlite
        .prepare('SELECT contact_id FROM contact_email WHERE id = ?')
        .get(Number(key)) as { contact_id: number } | undefined
      byContact(row?.contact_id)
    }
  }
  return [...found.values()]
}

/** The one record of the company the employee's record repeats, or null */
function original(
  sqlite: Sqlite,
  ctx: StaffContext,
  kind: ContactKind,
  id: number,
  merger: DuplicateMerger
): number | null {
  const candidates = merger.candidates(kind, id).filter((c) => !isOwnKey(ctx, c.id))
  const strong = candidates.filter((c) => /E-Mail|USt-IdNr/.test(c.reason))
  if (strong.length === 1) return strong[0].id
  if (strong.length > 1 || candidates.length !== 1) return null
  // same name only: not when both have e-mail addresses and none is the same
  const own = emailsOf(sqlite, kind, id)
  const theirs = emailsOf(sqlite, kind, candidates[0].id)
  return own.length > 0 && theirs.length > 0 ? null : candidates[0].id
}

/** Merges the employee's duplicates into the company's records; returns how many */
export function mergeStaffDuplicates(
  sqlite: Sqlite,
  ctx: StaffContext,
  touched: TouchedRow[],
  merger: DuplicateMerger
): number {
  let merged = 0
  for (const [kind, id] of ownRecords(sqlite, ctx, touched)) {
    if (!sqlite.prepare(`SELECT 1 FROM ${q(kind)} WHERE id = ?`).get(id)) continue
    const keepId = original(sqlite, ctx, kind, id, merger)
    if (keepId === null) continue
    merger.merge({ kind, keepId, dropId: id, take: [] })
    merger.share(kind, keepId)
    merged++
  }
  return merged
}
