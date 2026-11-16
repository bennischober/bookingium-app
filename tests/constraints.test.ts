// #151: the database itself refuses rows that break the rules the code relies on, so an
// import, a migration or a repository bug cannot store them past zod. One invalid row per
// constraint, written as raw SQL around every layer.
import { describe, expect, it, beforeAll } from 'vitest'
import { setupTestDb, getTestDb } from './helpers/setup'

setupTestDb()

beforeAll(() => {
  getTestDb().sqlite.exec(`
    insert into company (id, name, is_default_for_invoicing) values (1, 'Muster GmbH', 1), (2, 'Beispiel AG', 0);
    insert into person (id, first_name, last_name) values (1, 'Erika', 'Musterfrau');
    insert into band (id, name, company_id) values (1, 'Musterband', 1);
    insert into venue (id, name) values (1, 'Musterhalle');
    insert into venue_member (venue_id, person_id) values (1, 1);
    insert into deal_memo (id, name, date, band_id) values (1, 'Konzert', '2026-11-01', 1);
    insert into invoice (id, company_id) values (1, 1);
  `)
})

function run(sql: string) {
  return () => getTestDb().sqlite.exec(sql)
}

const CHECK = /CHECK constraint failed/
const UNIQUE = /UNIQUE constraint failed/

describe('enum columns', () => {
  it.each([
    ["insert into company (name, kind) values ('X', 'band')", 'company_kind_check'],
    ["insert into venue (name, kind) values ('X', 'club')", 'venue_kind_check'],
    [
      "insert into deal_memo (name, date, band_id, status) values ('X', '2026-11-01', 1, '')",
      'deal_memo_status_check'
    ],
    ["insert into invoice (company_id, status) values (1, 'sent')", 'invoice_status_check'],
    ["insert into invoice (company_id, kind) values (1, 'credit')", 'invoice_kind_check'],
    [
      "insert into invoice_party_snapshot (kind, legal_name) values ('venue', 'X')",
      'invoice_party_snapshot_kind_check'
    ],
    [
      "insert into invoice_line_item (invoice_id, description, tax_code) values (1, 'X', 'full')",
      'invoice_line_item_tax_code_check'
    ],
    [
      "insert into invoice_email (invoice_id, kind) values (1, 'contract')",
      'invoice_email_kind_check'
    ],
    [
      "insert into invoice_email_pending (invoice_id, kind, mail_account_id, send_key) values (1, 'contract', 'a', 'k')",
      'invoice_email_pending_kind_check'
    ],
    [
      "insert into invoice_status_change (invoice_id, status) values (1, 'sent')",
      'invoice_status_change_status_check'
    ],
    [
      "insert into datev_transfer (invoice_id, status, \"to\", file_name, mail_account_id, send_key) values (1, 'failed', 'u@x', 'R.pdf', 'a', 'k')",
      'datev_transfer_status_check'
    ],
    [
      "insert into mail_template (name, kind, lang) values ('X', 'offer', 'de')",
      'mail_template_kind_check'
    ],
    [
      "insert into mail_template (name, kind, lang) values ('X', 'invoice', 'fr')",
      'mail_template_lang_check'
    ],
    [
      "insert into external_booking (band_id, date, kind, agency, source_key, imported_at) values (1, '2026-11-01', 'club', 'A', 'k1', '2026-11-01 10:00:00')",
      'external_booking_kind_check'
    ],
    [
      "insert into external_booking (band_id, date, status, agency, source_key, imported_at) values (1, '2026-11-01', 'option', 'A', 'k2', '2026-11-01 10:00:00')",
      'external_booking_status_check'
    ]
  ])('%s', (sql, constraint) => {
    expect(run(sql)).toThrow(CHECK)
    expect(run(sql)).toThrow(constraint)
  })

  it('accepts every value the router accepts', () => {
    expect(
      run(`
        insert into company (name, kind) values ('Radio X', 'media');
        insert into venue (name, kind) values ('Open Air', 'festival');
        insert into invoice (company_id, status, kind) values (1, 'overdue', 'cancellation');
        insert into mail_template (name, kind, lang) values ('', 'contract', 'en');
        insert into mail_template (name) values ('Eigene Vorlage');
        insert into external_booking (band_id, date, kind, status, agency, source_key, imported_at)
          values (1, '2026-11-02', 'festival', 'cancelled', 'A', 'k3', '2026-11-01 10:00:00');
      `)
    ).not.toThrow()
  })

  it('creates an event without a status as pending', () => {
    const { sqlite } = getTestDb()
    sqlite.exec("insert into deal_memo (id, name, date, band_id) values (2, 'X', '2026-11-02', 1)")
    expect(sqlite.prepare('select status from deal_memo where id = 2').get()).toEqual({
      status: 'pending'
    })
  })
})

describe('rules that used to be comments', () => {
  it.each([
    [
      "insert into follow_up (due_date, note, event_id, band_id) values ('2026-11-01', 'X', 1, 1)",
      'follow_up_one_record'
    ],
    [
      "insert into appointment (title, start_date, end_date, venue_id, person_id) values ('X', '2026-11-01', '2026-11-01', 1, 1)",
      'appointment_one_record'
    ],
    [
      'insert into management_share (invoice_id, band_id, year, quarter, commission_percent) values (1, 1, 2026, 5, 20)',
      'management_share_quarter_check'
    ],
    [
      "insert into invoice_line_item (invoice_id, description, position) values (1, 'X', 0)",
      'invoice_line_item_position_check'
    ],
    [
      "insert into mail_template (name, kind) values ('X', 'invoice')",
      'mail_template_kind_lang_check'
    ]
  ])('%s', (sql, constraint) => {
    expect(run(sql)).toThrow(CHECK)
    expect(run(sql)).toThrow(constraint)
  })

  it('still allows a follow-up or appointment on one record or none', () => {
    expect(
      run(`
        insert into follow_up (due_date, note) values ('2026-11-01', 'Allgemein');
        insert into follow_up (due_date, note, invoice_id) values ('2026-11-01', 'Rechnung', 1);
        insert into appointment (title, start_date, end_date, band_id) values ('Probe', '2026-11-01', '2026-11-01', 1);
      `)
    ).not.toThrow()
  })
})

describe('uniqueness', () => {
  it('links a person to a venue once', () => {
    expect(run('insert into venue_member (venue_id, person_id) values (1, 1)')).toThrow(UNIQUE)
  })

  it('has one default company for invoicing', () => {
    expect(run('update company set is_default_for_invoicing = 1 where id = 2')).toThrow(UNIQUE)
    // Any number of companies that are not the default
    expect(run("insert into company (name) values ('A'), ('B')")).not.toThrow()
  })
})
