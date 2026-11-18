import { eq, max } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { schema } from '../../db/schema'
import type { InvoiceRecipientKind } from '../../api/schemas/invoice.schema'
import type { Tx } from '../tx'

/**
 * The parties of an invoice (issuer and recipient), frozen as
 * invoice_party_snapshot rows: building them from master data, resolving
 * which company issues and who receives, and refreshing them on issue.
 */

export type SnapshotRow = typeof schema.invoice_party_snapshot.$inferSelect
export type SnapshotValues = typeof schema.invoice_party_snapshot.$inferInsert

export type RecipientSnapshotInput = {
  dealMemoId?: number | null
  companyId?: number | null
  recipientKind?: InvoiceRecipientKind
  recipientCompanyId?: number | null
  recipientBandId?: number | null
  recipientPersonId?: number | null
  recipientNameOverride?: string
}

export function insertSnapshot(tx: Tx, values: SnapshotValues) {
  const inserted = tx.insert(schema.invoice_party_snapshot).values(values).returning().all()
  if (inserted.length === 0) {
    throw new Error('Failed to create party snapshot')
  }
  return inserted[0]
}

/** A company as frozen on an invoice, with its invoice contact person */
export function companySnapshotValues(tx: Tx, companyId: number): SnapshotValues {
  const contactPerson = alias(schema.person, 'contact_person')
  const contactPersonContact = alias(schema.contact, 'contact_person_contact')
  const rows = tx
    .select({
      company: schema.company,
      address: schema.address,
      contact: schema.contact,
      bank: schema.bank,
      contactPerson,
      contactPersonContact
    })
    .from(schema.company)
    .leftJoin(schema.address, eq(schema.company.address_id, schema.address.id))
    .leftJoin(schema.contact, eq(schema.company.contact_id, schema.contact.id))
    .leftJoin(schema.bank, eq(schema.company.bank_id, schema.bank.id))
    .leftJoin(contactPerson, eq(schema.company.invoice_contact_person_id, contactPerson.id))
    .leftJoin(contactPersonContact, eq(contactPerson.contact_id, contactPersonContact.id))
    .where(eq(schema.company.id, companyId))
    .limit(1)
    .all()

  if (rows.length === 0) {
    throw new Error('Firma nicht gefunden')
  }

  const row = rows[0]
  const person = row.contactPerson
  const personContact = row.contactPersonContact
  const companyPhone = row.contact?.phone || row.contact?.mobile_phone || ''
  return {
    kind: 'company',
    source_company_id: row.company.id,
    legal_name: row.company.name,
    customer_number: row.company.customer_number,
    street: row.address?.street ?? '',
    street_number: row.address?.street_number ?? '',
    zip_code: row.address?.zip_code ?? '',
    city: row.address?.city ?? '',
    country: row.address?.country ?? '',
    country_code: row.address?.country_code ?? '',
    vat_id: row.company.vat_id,
    tax_number: row.company.tax_number,
    commercial_register_no: row.company.commercial_register_no,
    register_court: row.company.register_court,
    website: row.contact?.homepage ?? '',
    account_holder: row.bank?.account_holder ?? '',
    bank_name: row.bank?.bank_name ?? '',
    // Only the main company has a logo (a stale one on another company is ignored)
    logo_path: row.company.is_default_for_invoicing ? row.company.logo_path : '',
    email: row.contact?.email ?? '',
    phone: row.contact?.phone ?? row.contact?.mobile_phone ?? '',
    iban: row.bank?.iban ?? '',
    bic: row.bank?.bic ?? '',
    // The contact person's own phone/e-mail, else the company's
    contact_name: person ? `${person.first_name} ${person.last_name}`.trim() : '',
    contact_phone: person
      ? personContact?.phone || personContact?.mobile_phone || companyPhone
      : '',
    contact_email: person ? personContact?.email || row.contact?.email || '' : ''
  }
}

function bandSnapshotValues(tx: Tx, bandId: number): SnapshotValues {
  const rows = tx
    .select({
      band: schema.band,
      company: schema.company,
      address: schema.address,
      contact: schema.contact,
      bank: schema.bank
    })
    .from(schema.band)
    .leftJoin(schema.company, eq(schema.band.company_id, schema.company.id))
    .leftJoin(schema.address, eq(schema.company.address_id, schema.address.id))
    .leftJoin(schema.contact, eq(schema.company.contact_id, schema.contact.id))
    .leftJoin(schema.bank, eq(schema.company.bank_id, schema.bank.id))
    .where(eq(schema.band.id, bandId))
    .limit(1)
    .all()

  if (rows.length === 0) {
    throw new Error('Band nicht gefunden')
  }

  const row = rows[0]
  return {
    kind: 'band',
    source_band_id: row.band.id,
    legal_name: row.band.name,
    customer_number: row.band.customer_number,
    street: row.address?.street ?? '',
    street_number: row.address?.street_number ?? '',
    zip_code: row.address?.zip_code ?? '',
    city: row.address?.city ?? '',
    country: row.address?.country ?? '',
    country_code: row.address?.country_code ?? '',
    vat_id: row.company?.vat_id ?? '',
    email: row.contact?.email ?? '',
    phone: row.contact?.phone ?? row.contact?.mobile_phone ?? '',
    iban: row.bank?.iban ?? '',
    bic: row.bank?.bic ?? ''
  }
}

function personSnapshotValues(tx: Tx, personId: number): SnapshotValues {
  const rows = tx
    .select({
      person: schema.person,
      address: schema.address,
      contact: schema.contact
    })
    .from(schema.person)
    .leftJoin(schema.address, eq(schema.person.address_id, schema.address.id))
    .leftJoin(schema.contact, eq(schema.person.contact_id, schema.contact.id))
    .where(eq(schema.person.id, personId))
    .limit(1)
    .all()

  if (rows.length === 0) {
    throw new Error('Person nicht gefunden')
  }

  const row = rows[0]
  return {
    kind: 'person',
    source_person_id: row.person.id,
    legal_name: `${row.person.first_name} ${row.person.last_name}`.trim(),
    customer_number: row.person.customer_number,
    street: row.address?.street ?? '',
    street_number: row.address?.street_number ?? '',
    zip_code: row.address?.zip_code ?? '',
    city: row.address?.city ?? '',
    country: row.address?.country ?? '',
    country_code: row.address?.country_code ?? '',
    email: row.contact?.email ?? '',
    phone: row.contact?.phone ?? row.contact?.mobile_phone ?? ''
  }
}

export function createCompanySnapshot(tx: Tx, companyId: number) {
  return insertSnapshot(tx, companySnapshotValues(tx, companyId))
}

export function snapshotById(tx: Tx, id: number | null): SnapshotRow | undefined {
  if (!id) return undefined
  return tx
    .select()
    .from(schema.invoice_party_snapshot)
    .where(eq(schema.invoice_party_snapshot.id, id))
    .all()[0]
}

/**
 * The same party with its current master data (kind and source kept).
 * Manual recipients and parties whose record is gone stay as they were.
 */
export function currentSnapshotValues(tx: Tx, snapshot: SnapshotRow): SnapshotValues {
  const has = (
    table: typeof schema.company | typeof schema.band | typeof schema.person,
    id: number
  ) => tx.select({ id: table.id }).from(table).where(eq(table.id, id)).all().length > 0
  const { kind, source_company_id, source_band_id, source_person_id } = snapshot
  if (kind === 'company' && source_company_id && has(schema.company, source_company_id)) {
    return companySnapshotValues(tx, source_company_id)
  }
  if (kind === 'band' && source_band_id && has(schema.band, source_band_id)) {
    return bandSnapshotValues(tx, source_band_id)
  }
  if (kind === 'person' && source_person_id && has(schema.person, source_person_id)) {
    return personSnapshotValues(tx, source_person_id)
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, created_at, ...values } = snapshot
  return values
}

const NEXT_CUSTOMER_NUMBER = 'nextCustomerNumber'
/** Where customer numbers start when nothing is set (AppSettings.nextCustomerNumber's default) */
export const FIRST_CUSTOMER_NUMBER = 10000

/**
 * The next free Kundennummer: the one set in the settings, but never one a company, band or
 * person already has (numbers entered by hand or imported from DATEV)
 */
function nextCustomerNumberTx(tx: Tx): number {
  const stored = tx
    .select({ value: schema.app_setting.value })
    .from(schema.app_setting)
    .where(eq(schema.app_setting.key, NEXT_CUSTOMER_NUMBER))
    .get()
  const setting = Number(stored ? JSON.parse(stored.value) : FIRST_CUSTOMER_NUMBER)
  const highest = [schema.company, schema.band, schema.person].map(
    (table) =>
      tx
        .select({ value: max(table.customer_number) })
        .from(table)
        .get()?.value ?? 0
  )
  return Math.max(
    Number.isInteger(setting) ? setting : FIRST_CUSTOMER_NUMBER,
    ...highest.map((n) => n + 1)
  )
}

/**
 * A recipient gets its Kundennummer with its first issued invoice: a company, band or person
 * without one takes the next free number, which is stored on the record and in the settings.
 * Manual recipients ('other') have none.
 */
export function withCustomerNumberTx(tx: Tx, values: SnapshotValues): SnapshotValues {
  if (values.customer_number != null) return values
  const source =
    values.kind === 'company' && values.source_company_id
      ? { table: schema.company, id: values.source_company_id }
      : values.kind === 'band' && values.source_band_id
        ? { table: schema.band, id: values.source_band_id }
        : values.kind === 'person' && values.source_person_id
          ? { table: schema.person, id: values.source_person_id }
          : null
  if (!source) return values
  const number = nextCustomerNumberTx(tx)
  tx.update(source.table)
    .set({ customer_number: number })
    .where(eq(source.table.id, source.id))
    .run()
  tx.insert(schema.app_setting)
    .values({ key: NEXT_CUSTOMER_NUMBER, value: JSON.stringify(number + 1) })
    .onConflictDoUpdate({
      target: schema.app_setting.key,
      set: { value: JSON.stringify(number + 1) }
    })
    .run()
  return { ...values, customer_number: number }
}

/** Issuing freezes both parties as they are now: fresh snapshots */
export function issueSnapshotIds(
  tx: Tx,
  invoiceRow: Pick<typeof schema.invoice.$inferSelect, 'company_id' | 'recipient_snapshot_id'>
) {
  const recipient = snapshotById(tx, invoiceRow.recipient_snapshot_id)
  return {
    issuer_snapshot_id: createCompanySnapshot(tx, invoiceRow.company_id).id,
    recipient_snapshot_id: recipient
      ? insertSnapshot(tx, withCustomerNumberTx(tx, currentSnapshotValues(tx, recipient))).id
      : invoiceRow.recipient_snapshot_id
  }
}

/**
 * The issuing company: the one given, else the event's invoicing or LoPro
 * company, else the default company for invoicing
 */
export function resolveInvoiceCompanyId(
  tx: Tx,
  input: Pick<RecipientSnapshotInput, 'companyId' | 'dealMemoId'>
) {
  if (input.companyId) return input.companyId

  if (input.dealMemoId) {
    const memoRows = tx
      .select({
        invoiceCompanyId: schema.deal_memo.invoice_company_id,
        loProCompanyId: schema.deal_memo.lopro_company_id
      })
      .from(schema.deal_memo)
      .where(eq(schema.deal_memo.id, input.dealMemoId))
      .limit(1)
      .all()

    if (memoRows.length > 0) {
      if (memoRows[0].invoiceCompanyId) {
        return memoRows[0].invoiceCompanyId
      }

      if (memoRows[0].loProCompanyId) {
        return memoRows[0].loProCompanyId
      }
    }
  }

  const defaultCompany = tx
    .select({ id: schema.company.id })
    .from(schema.company)
    .where(eq(schema.company.is_default_for_invoicing, true))
    .limit(1)
    .all()

  if (defaultCompany.length === 0) {
    throw new Error(
      'No invoicing company configured. Set a default company or pick one explicitly.'
    )
  }

  return defaultCompany[0].id
}

export function resolveRecipientSnapshot(
  tx: Tx,
  input: RecipientSnapshotInput,
  issuerCompanyId: number
) {
  return insertSnapshot(tx, resolveRecipientValues(tx, input, issuerCompanyId))
}

/** The recipient's values for the chosen kind; without one, from the event or the issuer */
export function resolveRecipientValues(
  tx: Tx,
  input: RecipientSnapshotInput,
  issuerCompanyId: number
): SnapshotValues {
  const kind = input.recipientKind

  if (kind === 'company') {
    const recipientCompanyId = input.recipientCompanyId ?? input.companyId ?? issuerCompanyId
    return companySnapshotValues(tx, recipientCompanyId)
  }

  if (kind === 'band') {
    if (!input.recipientBandId) {
      throw new Error('recipientBandId is required when recipientKind is band')
    }
    return bandSnapshotValues(tx, input.recipientBandId)
  }

  if (kind === 'person') {
    if (!input.recipientPersonId) {
      throw new Error('recipientPersonId is required when recipientKind is person')
    }
    return personSnapshotValues(tx, input.recipientPersonId)
  }

  if (kind === 'other') {
    const manualName = input.recipientNameOverride?.trim()
    if (!manualName) {
      throw new Error('recipientNameOverride is required when recipientKind is other')
    }
    return { kind: 'other', legal_name: manualName }
  }

  if (input.dealMemoId) {
    const memoRows = tx
      .select({
        bandId: schema.deal_memo.band_id,
        loProCompanyId: schema.deal_memo.lopro_company_id
      })
      .from(schema.deal_memo)
      .where(eq(schema.deal_memo.id, input.dealMemoId))
      .limit(1)
      .all()

    if (memoRows.length > 0) {
      if (memoRows[0].loProCompanyId) {
        return companySnapshotValues(tx, memoRows[0].loProCompanyId)
      }

      if (memoRows[0].bandId) {
        return bandSnapshotValues(tx, memoRows[0].bandId)
      }
    }
  }

  return companySnapshotValues(tx, issuerCompanyId)
}
