import { injectable } from 'tsyringe'
import { and, asc, desc, eq, inArray, like, or, sql, type SQL } from 'drizzle-orm'
import { listOrder, listPage } from './listQuery'
import { db } from '../db'
import { schema } from '../db/schema'
import { alias } from 'drizzle-orm/sqlite-core'
import type {
  CreateInvoiceInput,
  CreateInvoiceForDealMemoInput,
  InvoiceLineItemInput,
  InvoiceRecipientKind,
  InvoiceStatus,
  UpsertCompanyInvoiceSettingsInput,
  UpdateInvoiceInput
} from '../api/schemas/invoice.schema'
import type { PaginationInput } from '../api/schemas/base.schema'
import { computeInvoiceAmounts, fromCents } from '../einvoice/amounts'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

type SnapshotRow = typeof schema.invoice_party_snapshot.$inferSelect
type InvoiceRow = typeof schema.invoice.$inferSelect

/** A Stornorechnung's original, or an invoice's Stornorechnung */
type CancellationLinks = {
  cancelsInvoice: { id: number; invoice_number: number | null; issue_date: string } | null
  cancelledBy: { id: number; invoice_number: number | null } | null
}

/** "2026-10-16" -> "16.10.2026" */
function germanDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day}.${month}.${year}`
}
type SnapshotValues = typeof schema.invoice_party_snapshot.$inferInsert

type InvoiceListRow = {
  invoice: typeof schema.invoice.$inferSelect
  company: typeof schema.company.$inferSelect | null
  deal_memo: typeof schema.deal_memo.$inferSelect | null
  invoice_party_snapshot: typeof schema.invoice_party_snapshot.$inferSelect | null
}

type RecipientSnapshotInput = {
  dealMemoId?: number | null
  companyId?: number | null
  recipientKind?: InvoiceRecipientKind
  recipientCompanyId?: number | null
  recipientBandId?: number | null
  recipientPersonId?: number | null
  recipientNameOverride?: string
}

@injectable()
export class InvoiceRepository {
  /** Line items with amounts, and the invoice totals (rounded in einvoice/amounts) */
  private normalizeLineItems(
    lineItems: InvoiceLineItemInput[] | undefined,
    fallbackTotalAmount: number | undefined
  ) {
    const source =
      lineItems && lineItems.length > 0
        ? lineItems
        : [
            {
              description: 'General service fee',
              quantity: 1,
              unit: 'service',
              unitPriceNet: fallbackTotalAmount ?? 0,
              taxRate: 0,
              taxCode: 'other' as const
            }
          ]

    const lines = source.map((item) => ({
      description: item.description,
      quantity: item.quantity ?? 1,
      unit: item.unit ?? 'service',
      unitPriceNet: item.unitPriceNet,
      taxRate: item.taxRate ?? 0,
      taxCode: item.taxCode ?? 'standard'
    }))
    const amounts = computeInvoiceAmounts(lines)

    return {
      items: lines.map((line, index) => ({
        ...line,
        position: index + 1,
        lineNetAmount: fromCents(amounts.lines[index].netCents),
        lineTaxAmount: fromCents(amounts.lines[index].taxCents),
        lineGrossAmount: fromCents(amounts.lines[index].grossCents)
      })),
      totals: {
        subtotalNetAmount: fromCents(amounts.netCents),
        subtotalTaxAmount: fromCents(amounts.taxCents),
        totalGrossAmount: fromCents(amounts.grossCents)
      }
    }
  }

  private insertSnapshot(tx: Tx, values: SnapshotValues) {
    const inserted = tx.insert(schema.invoice_party_snapshot).values(values).returning().all()
    if (inserted.length === 0) {
      throw new Error('Failed to create party snapshot')
    }
    return inserted[0]
  }

  /** A company as frozen on an invoice, with its invoice contact person */
  private companySnapshotValues(tx: Tx, companyId: number): SnapshotValues {
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
      throw new Error('Company not found')
    }

    const row = rows[0]
    const person = row.contactPerson
    const personContact = row.contactPersonContact
    const companyPhone = row.contact?.phone || row.contact?.mobile_phone || ''
    return {
      kind: 'company',
      source_company_id: row.company.id,
      legal_name: row.company.name,
      street: row.address?.street ?? '',
      street_number: row.address?.street_number ?? '',
      zip_code: row.address?.zip_code ?? '',
      city: row.address?.city ?? '',
      country: row.address?.country ?? '',
      country_code: row.address?.country_code ?? '',
      vat_number: row.company.vat_number,
      ust_number: row.company.ust_number,
      tax_number: row.company.tax_number,
      commercial_register_no: row.company.commercial_register_no,
      register_court: row.company.register_court,
      website: row.contact?.homepage ?? '',
      account_holder: row.bank?.account_holder ?? '',
      bank_name: row.bank?.bank_name ?? '',
      logo_path: row.company.logo_path,
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

  private bandSnapshotValues(tx: Tx, bandId: number): SnapshotValues {
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
      throw new Error('Band not found')
    }

    const row = rows[0]
    return {
      kind: 'band',
      source_band_id: row.band.id,
      legal_name: row.band.name,
      street: row.address?.street ?? '',
      street_number: row.address?.street_number ?? '',
      zip_code: row.address?.zip_code ?? '',
      city: row.address?.city ?? '',
      country: row.address?.country ?? '',
      country_code: row.address?.country_code ?? '',
      vat_number: row.company?.vat_number ?? '',
      ust_number: row.company?.ust_number ?? '',
      email: row.contact?.email ?? '',
      phone: row.contact?.phone ?? row.contact?.mobile_phone ?? '',
      iban: row.bank?.iban ?? '',
      bic: row.bank?.bic ?? ''
    }
  }

  private personSnapshotValues(tx: Tx, personId: number): SnapshotValues {
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
      throw new Error('Person not found')
    }

    const row = rows[0]
    return {
      kind: 'person',
      source_person_id: row.person.id,
      legal_name: `${row.person.first_name} ${row.person.last_name}`.trim(),
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

  private createCompanySnapshot(tx: Tx, companyId: number) {
    return this.insertSnapshot(tx, this.companySnapshotValues(tx, companyId))
  }

  private snapshotById(tx: Tx, id: number | null): SnapshotRow | undefined {
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
  private currentSnapshotValues(tx: Tx, snapshot: SnapshotRow): SnapshotValues {
    const has = (
      table: typeof schema.company | typeof schema.band | typeof schema.person,
      id: number
    ) => tx.select({ id: table.id }).from(table).where(eq(table.id, id)).all().length > 0
    const { kind, source_company_id, source_band_id, source_person_id } = snapshot
    if (kind === 'company' && source_company_id && has(schema.company, source_company_id)) {
      return this.companySnapshotValues(tx, source_company_id)
    }
    if (kind === 'band' && source_band_id && has(schema.band, source_band_id)) {
      return this.bandSnapshotValues(tx, source_band_id)
    }
    if (kind === 'person' && source_person_id && has(schema.person, source_person_id)) {
      return this.personSnapshotValues(tx, source_person_id)
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, created_at, ...values } = snapshot
    return values
  }

  /** Issuing freezes both parties as they are now: fresh snapshots */
  private issueSnapshotIds(
    tx: Tx,
    invoiceRow: Pick<typeof schema.invoice.$inferSelect, 'company_id' | 'recipient_snapshot_id'>
  ) {
    const recipient = this.snapshotById(tx, invoiceRow.recipient_snapshot_id)
    return {
      issuer_snapshot_id: this.createCompanySnapshot(tx, invoiceRow.company_id).id,
      recipient_snapshot_id: recipient
        ? this.insertSnapshot(tx, this.currentSnapshotValues(tx, recipient)).id
        : invoiceRow.recipient_snapshot_id
    }
  }

  /** A draft's parties with their current master data, as issuing would freeze them */
  currentParties(invoiceId: number) {
    return db.transaction((tx) => {
      const row = tx.select().from(schema.invoice).where(eq(schema.invoice.id, invoiceId)).all()[0]
      if (!row) throw new Error('Invoice not found')
      const recipient = this.snapshotById(tx, row.recipient_snapshot_id)
      return {
        issuer: this.companySnapshotValues(tx, row.company_id),
        recipient: recipient ? this.currentSnapshotValues(tx, recipient) : null
      }
    })
  }

  /**
   * Issuer and recipient as an invoice with this input would freeze them
   * now; nothing is written (e-invoice check in the invoice form)
   */
  previewParties(input: RecipientSnapshotInput) {
    return db.transaction((tx) => {
      const companyId = this.resolveInvoiceCompanyId(tx, input as CreateInvoiceInput)
      return {
        issuer: this.companySnapshotValues(tx, companyId),
        recipient: this.resolveRecipientValues(tx, input, companyId)
      }
    })
  }

  private resolveInvoiceCompanyId(tx: Tx, input: CreateInvoiceInput) {
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

  private resolveRecipientSnapshot(tx: Tx, input: RecipientSnapshotInput, issuerCompanyId: number) {
    return this.insertSnapshot(tx, this.resolveRecipientValues(tx, input, issuerCompanyId))
  }

  private resolveRecipientValues(
    tx: Tx,
    input: RecipientSnapshotInput,
    issuerCompanyId: number
  ): SnapshotValues {
    const kind = input.recipientKind

    if (kind === 'company') {
      const recipientCompanyId = input.recipientCompanyId ?? input.companyId ?? issuerCompanyId
      return this.companySnapshotValues(tx, recipientCompanyId)
    }

    if (kind === 'band') {
      if (!input.recipientBandId) {
        throw new Error('recipientBandId is required when recipientKind is band')
      }
      return this.bandSnapshotValues(tx, input.recipientBandId)
    }

    if (kind === 'person') {
      if (!input.recipientPersonId) {
        throw new Error('recipientPersonId is required when recipientKind is person')
      }
      return this.personSnapshotValues(tx, input.recipientPersonId)
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
          return this.companySnapshotValues(tx, memoRows[0].loProCompanyId)
        }

        if (memoRows[0].bandId) {
          return this.bandSnapshotValues(tx, memoRows[0].bandId)
        }
      }
    }

    return this.companySnapshotValues(tx, issuerCompanyId)
  }

  /** Adds the Stornorechnung links (one extra query for all rows) */
  private withCancellationLinks<T extends Pick<InvoiceRow, 'id' | 'cancels_invoice_id'>>(
    reader: Pick<Tx, 'select'>,
    rows: T[]
  ): Array<T & CancellationLinks> {
    const ids = rows.map((row) => row.id)
    const originalIds = rows
      .map((row) => row.cancels_invoice_id)
      .filter((id): id is number => id !== null)
    const related =
      rows.length === 0
        ? []
        : reader
            .select({
              id: schema.invoice.id,
              invoice_number: schema.invoice.invoice_number,
              issue_date: schema.invoice.issue_date,
              cancels_invoice_id: schema.invoice.cancels_invoice_id
            })
            .from(schema.invoice)
            .where(
              or(
                inArray(schema.invoice.id, originalIds),
                inArray(schema.invoice.cancels_invoice_id, ids)
              )
            )
            .all()
    return rows.map((row) => {
      const original = related.find((other) => other.id === row.cancels_invoice_id)
      const cancellation = related.find((other) => other.cancels_invoice_id === row.id)
      return {
        ...row,
        cancelsInvoice: original
          ? {
              id: original.id,
              invoice_number: original.invoice_number,
              issue_date: original.issue_date
            }
          : null,
        cancelledBy: cancellation
          ? { id: cancellation.id, invoice_number: cancellation.invoice_number }
          : null
      }
    })
  }

  private loadInvoiceWithRelationsTx(tx: Tx, invoiceId: number) {
    const rows = tx
      .select()
      .from(schema.invoice)
      .leftJoin(schema.company, eq(schema.invoice.company_id, schema.company.id))
      .leftJoin(schema.deal_memo, eq(schema.invoice.deal_memo_id, schema.deal_memo.id))
      .leftJoin(
        schema.invoice_party_snapshot,
        eq(schema.invoice.recipient_snapshot_id, schema.invoice_party_snapshot.id)
      )
      .where(eq(schema.invoice.id, invoiceId))
      .limit(1)
      .all() as InvoiceListRow[]

    if (rows.length === 0) {
      throw new Error('Invoice not found')
    }

    const lineItems = tx
      .select()
      .from(schema.invoice_line_item)
      .where(eq(schema.invoice_line_item.invoice_id, invoiceId))
      .orderBy(asc(schema.invoice_line_item.position), asc(schema.invoice_line_item.id))
      .all()

    const row = rows[0]
    return this.withCancellationLinks(tx, [
      {
        ...row.invoice,
        company: row.company,
        dealMemo: row.deal_memo,
        recipientSnapshot: row.invoice_party_snapshot,
        lineItems
      }
    ])[0]
  }

  async getAllPaginated(pagination: PaginationInput) {
    const { search } = pagination
    const { page, pageSize, offset } = listPage(pagination)

    const whereClause = search
      ? or(
          like(schema.company.name, `%${search}%`),
          like(schema.deal_memo.name, `%${search}%`),
          like(schema.invoice_party_snapshot.legal_name, `%${search}%`),
          like(schema.invoice.period_label, `%${search}%`),
          like(schema.invoice.status, `%${search}%`),
          like(schema.invoice.currency, `%${search}%`),
          sql`CAST(${schema.invoice.invoice_number} AS TEXT) LIKE ${`%${search}%`}`
        )
      : undefined

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.invoice)
      .leftJoin(schema.company, eq(schema.invoice.company_id, schema.company.id))
      .leftJoin(schema.deal_memo, eq(schema.invoice.deal_memo_id, schema.deal_memo.id))
      .leftJoin(
        schema.invoice_party_snapshot,
        eq(schema.invoice.recipient_snapshot_id, schema.invoice_party_snapshot.id)
      )
      .where(whereClause)

    const total = countResult[0]?.count || 0

    const rows = await db
      .select()
      .from(schema.invoice)
      .leftJoin(schema.company, eq(schema.invoice.company_id, schema.company.id))
      .leftJoin(schema.deal_memo, eq(schema.invoice.deal_memo_id, schema.deal_memo.id))
      .leftJoin(
        schema.invoice_party_snapshot,
        eq(schema.invoice.recipient_snapshot_id, schema.invoice_party_snapshot.id)
      )
      .where(whereClause)
      .orderBy(
        ...listOrder(
          pagination,
          {
            invoiceNumber: [schema.invoice.invoice_number],
            companyName: [schema.company.name],
            recipientName: [schema.invoice_party_snapshot.legal_name],
            periodLabel: [schema.invoice.period_label],
            dealMemoName: [schema.deal_memo.name],
            issueDate: [schema.invoice.issue_date, schema.invoice.created_at],
            status: [schema.invoice.status],
            totalAmount: [schema.invoice.total_amount]
          },
          { key: 'issueDate', dir: 'desc' },
          schema.invoice.id
        )
      )
      .limit(pageSize)
      .offset(offset)

    const items = this.withCancellationLinks(
      db,
      rows.map((row) => ({
        ...row.invoice,
        company: row.company,
        dealMemo: row.deal_memo,
        recipientSnapshot: row.invoice_party_snapshot,
        lineItems: []
      }))
    )

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }
  }

  async getById(id: number) {
    const rows = await db
      .select()
      .from(schema.invoice)
      .leftJoin(schema.company, eq(schema.invoice.company_id, schema.company.id))
      .leftJoin(schema.deal_memo, eq(schema.invoice.deal_memo_id, schema.deal_memo.id))
      .leftJoin(
        schema.invoice_party_snapshot,
        eq(schema.invoice.recipient_snapshot_id, schema.invoice_party_snapshot.id)
      )
      .where(eq(schema.invoice.id, id))
      .limit(1)

    if (rows.length === 0) {
      return null
    }

    const lineItems = await db
      .select()
      .from(schema.invoice_line_item)
      .where(eq(schema.invoice_line_item.invoice_id, id))
      .orderBy(asc(schema.invoice_line_item.position), asc(schema.invoice_line_item.id))

    const row = rows[0]
    return this.withCancellationLinks(db, [
      {
        ...row.invoice,
        company: row.company,
        dealMemo: row.deal_memo,
        recipientSnapshot: row.invoice_party_snapshot,
        lineItems
      }
    ])[0]
  }

  async getByIdWithSnapshots(id: number) {
    const issuerSnapshot = alias(schema.invoice_party_snapshot, 'issuer_snapshot')
    const recipientSnapshot = alias(schema.invoice_party_snapshot, 'recipient_snapshot')
    const eventBand = alias(schema.band, 'event_band')

    const rows = await db
      .select()
      .from(schema.invoice)
      .leftJoin(schema.company, eq(schema.invoice.company_id, schema.company.id))
      .leftJoin(schema.deal_memo, eq(schema.invoice.deal_memo_id, schema.deal_memo.id))
      .leftJoin(schema.venue, eq(schema.deal_memo.venue_id, schema.venue.id))
      .leftJoin(eventBand, eq(schema.deal_memo.band_id, eventBand.id))
      .leftJoin(issuerSnapshot, eq(schema.invoice.issuer_snapshot_id, issuerSnapshot.id))
      .leftJoin(recipientSnapshot, eq(schema.invoice.recipient_snapshot_id, recipientSnapshot.id))
      .leftJoin(schema.management_share, eq(schema.management_share.invoice_id, schema.invoice.id))
      .leftJoin(schema.band, eq(schema.management_share.band_id, schema.band.id))
      .where(eq(schema.invoice.id, id))
      .limit(1)

    if (rows.length === 0) {
      return null
    }

    const lineItems = await db
      .select()
      .from(schema.invoice_line_item)
      .where(eq(schema.invoice_line_item.invoice_id, id))
      .orderBy(asc(schema.invoice_line_item.position), asc(schema.invoice_line_item.id))

    const row = rows[0]
    const [links] = this.withCancellationLinks(db, [row.invoice])
    return {
      ...links,
      company: row.company,
      dealMemo: row.deal_memo,
      venueName: row.venue?.name ?? null,
      // Quarterly management share: the band it was billed for
      managementShareBandName: row.band?.name ?? null,
      // Linked event: the band that played
      eventBandName: row.event_band?.name ?? null,
      issuerSnapshot: row.issuer_snapshot,
      recipientSnapshot: row.recipient_snapshot,
      lineItems
    }
  }

  async getCompanyInvoiceSettings(companyId: number) {
    const rows = await db
      .select()
      .from(schema.company_invoice_settings)
      .where(eq(schema.company_invoice_settings.company_id, companyId))
      .limit(1)

    return rows[0] ?? null
  }

  async upsertCompanyInvoiceSettings(input: UpsertCompanyInvoiceSettingsInput) {
    return db.transaction((tx) => {
      const existing = tx
        .select()
        .from(schema.company_invoice_settings)
        .where(eq(schema.company_invoice_settings.company_id, input.companyId))
        .limit(1)
        .all()

      if (existing.length > 0) {
        const updated = tx
          .update(schema.company_invoice_settings)
          .set({
            next_invoice_number: input.nextInvoiceNumber,
            updated_at: sql`datetime('now')`
          })
          .where(eq(schema.company_invoice_settings.id, existing[0].id))
          .returning()
          .all()

        return updated[0]
      }

      const created = tx
        .insert(schema.company_invoice_settings)
        .values({
          company_id: input.companyId,
          next_invoice_number: input.nextInvoiceNumber
        })
        .returning()
        .all()

      return created[0]
    })
  }

  /** An invoice needs a non-zero total before it can be issued */
  private assertIssuable(totalGrossAmount: number) {
    if (totalGrossAmount === 0) {
      throw new Error(
        'Eine Rechnung über 0,00 kann nicht gestellt werden – bitte Positionen erfassen'
      )
    }
  }

  /** Takes the company's next invoice number and advances its counter */
  private takeNextInvoiceNumber(tx: Tx, companyId: number): number {
    const existingSettings = tx
      .select()
      .from(schema.company_invoice_settings)
      .where(eq(schema.company_invoice_settings.company_id, companyId))
      .limit(1)
      .all()

    const assignedInvoiceNumber = existingSettings[0]?.next_invoice_number ?? 1

    if (existingSettings.length > 0) {
      tx.update(schema.company_invoice_settings)
        .set({
          next_invoice_number: assignedInvoiceNumber + 1,
          updated_at: sql`datetime('now')`
        })
        .where(eq(schema.company_invoice_settings.id, existingSettings[0].id))
        .run()
    } else {
      tx.insert(schema.company_invoice_settings)
        .values({
          company_id: companyId,
          next_invoice_number: assignedInvoiceNumber + 1
        })
        .run()
    }

    return assignedInvoiceNumber
  }

  async create(input: CreateInvoiceInput) {
    return db.transaction((tx) => this.createTx(tx, input))
  }

  /** Creates an invoice inside a caller's transaction (e.g. with records that point to it) */
  createTx(tx: Tx, input: CreateInvoiceInput) {
    const companyId = this.resolveInvoiceCompanyId(tx, input)
    const issuerSnapshot = this.createCompanySnapshot(tx, companyId)
    const recipientSnapshot = this.resolveRecipientSnapshot(tx, input, companyId)
    const { items: normalizedLineItems, totals } = this.normalizeLineItems(
      input.lineItems,
      input.totalAmount
    )

    const status = input.status ?? 'draft'
    // Drafts get their number when they are issued
    if (status !== 'draft') this.assertIssuable(totals.totalGrossAmount)
    const assignedInvoiceNumber =
      status === 'draft' ? null : this.takeNextInvoiceNumber(tx, companyId)

    const created = tx
      .insert(schema.invoice)
      .values({
        invoice_number: assignedInvoiceNumber,
        company_id: companyId,
        issuer_snapshot_id: issuerSnapshot.id,
        recipient_snapshot_id: recipientSnapshot.id,
        deal_memo_id: input.dealMemoId ?? null,
        period_start_date: input.periodStartDate ?? null,
        period_end_date: input.periodEndDate ?? null,
        period_label: input.periodLabel ?? '',
        issue_date: input.issueDate ?? new Date().toISOString().slice(0, 10),
        due_date: input.dueDate ?? null,
        status,
        currency: input.currency ?? 'EUR',
        subtotal_net_amount: totals.subtotalNetAmount,
        subtotal_tax_amount: totals.subtotalTaxAmount,
        total_gross_amount: totals.totalGrossAmount,
        total_amount: totals.totalGrossAmount,
        payment_terms: input.paymentTerms ?? '',
        reverse_charge_note: input.reverseChargeNote ?? '',
        buyer_reference: input.buyerReference ?? '',
        xrechnung: input.xrechnung ?? false,
        notes: input.notes ?? ''
      })
      .returning()
      .all()

    if (created.length === 0) {
      throw new Error('Failed to create invoice record')
    }

    const invoiceId = created[0].id

    for (const item of normalizedLineItems) {
      tx.insert(schema.invoice_line_item)
        .values({
          invoice_id: invoiceId,
          position: item.position,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unit_price_net: item.unitPriceNet,
          line_net_amount: item.lineNetAmount,
          tax_rate: item.taxRate,
          tax_code: item.taxCode,
          line_tax_amount: item.lineTaxAmount,
          line_gross_amount: item.lineGrossAmount
        })
        .run()
    }

    return this.loadInvoiceWithRelationsTx(tx, invoiceId)
  }

  async createForDealMemo(input: CreateInvoiceForDealMemoInput) {
    return this.create(input)
  }

  async update(input: UpdateInvoiceInput) {
    const normalized =
      'lineItems' in input && input.lineItems
        ? this.normalizeLineItems(input.lineItems, input.totalAmount)
        : null
    const normalizedLineItems = normalized?.items ?? null
    const computedTotals = normalized?.totals ?? null

    const values: Record<string, unknown> = {
      updated_at: sql`datetime('now')`
    }

    if ('periodStartDate' in input) values.period_start_date = input.periodStartDate ?? null
    if ('periodEndDate' in input) values.period_end_date = input.periodEndDate ?? null
    if ('periodLabel' in input) values.period_label = input.periodLabel ?? ''
    if ('issueDate' in input) values.issue_date = input.issueDate
    if ('dueDate' in input) values.due_date = input.dueDate ?? null
    if ('status' in input) values.status = input.status
    if ('currency' in input) values.currency = input.currency
    if (computedTotals) {
      values.subtotal_net_amount = computedTotals.subtotalNetAmount
      values.subtotal_tax_amount = computedTotals.subtotalTaxAmount
      values.total_gross_amount = computedTotals.totalGrossAmount
      values.total_amount = computedTotals.totalGrossAmount
    } else if ('totalAmount' in input) {
      values.total_gross_amount = input.totalAmount
      values.total_amount = input.totalAmount
    }
    if ('paymentTerms' in input) values.payment_terms = input.paymentTerms
    if ('reverseChargeNote' in input) values.reverse_charge_note = input.reverseChargeNote
    if ('buyerReference' in input) values.buyer_reference = input.buyerReference
    if ('xrechnung' in input) values.xrechnung = input.xrechnung
    if ('notes' in input) values.notes = input.notes

    return db.transaction((tx) => {
      const existingRows = tx
        .select()
        .from(schema.invoice)
        .where(eq(schema.invoice.id, input.id))
        .limit(1)
        .all()

      if (existingRows.length === 0) {
        throw new Error('Invoice not found')
      }

      const existing = existingRows[0]

      if ('dealMemoId' in input) {
        values.deal_memo_id = input.dealMemoId ?? null
      }

      const nextCompanyId = input.companyId ?? existing.company_id
      if ('companyId' in input) {
        values.company_id = nextCompanyId
        const issuerSnapshot = this.createCompanySnapshot(tx, nextCompanyId)
        values.issuer_snapshot_id = issuerSnapshot.id
      }

      const recipientFieldsTouched =
        'recipientKind' in input ||
        'recipientCompanyId' in input ||
        'recipientBandId' in input ||
        'recipientPersonId' in input ||
        'recipientNameOverride' in input ||
        'dealMemoId' in input

      if (recipientFieldsTouched) {
        const inferredKind: InvoiceRecipientKind | undefined =
          input.recipientKind ??
          (input.recipientBandId ? 'band' : undefined) ??
          (input.recipientPersonId ? 'person' : undefined) ??
          (input.recipientCompanyId ? 'company' : undefined) ??
          (input.recipientNameOverride ? 'other' : undefined)

        const recipientSnapshot = this.resolveRecipientSnapshot(
          tx,
          {
            dealMemoId:
              'dealMemoId' in input ? (input.dealMemoId ?? null) : (existing.deal_memo_id ?? null),
            companyId: nextCompanyId,
            recipientKind: inferredKind,
            recipientCompanyId: input.recipientCompanyId ?? null,
            recipientBandId: input.recipientBandId ?? null,
            recipientPersonId: input.recipientPersonId ?? null,
            recipientNameOverride: input.recipientNameOverride
          },
          nextCompanyId
        )
        values.recipient_snapshot_id = recipientSnapshot.id
      }

      // Issuing a draft: it gets the (possibly changed) issuer's next number,
      // and both parties are frozen as they are now
      const issuing = values.status !== undefined && values.status !== 'draft'
      if (issuing && existing.invoice_number === null) {
        this.assertIssuable(
          (values.total_gross_amount as number | undefined) ?? existing.total_gross_amount
        )
        values.invoice_number = this.takeNextInvoiceNumber(tx, nextCompanyId)
        Object.assign(
          values,
          this.issueSnapshotIds(tx, {
            company_id: nextCompanyId,
            recipient_snapshot_id:
              (values.recipient_snapshot_id as number | undefined) ?? existing.recipient_snapshot_id
          })
        )
      }

      const updated = tx
        .update(schema.invoice)
        .set(values)
        .where(eq(schema.invoice.id, input.id))
        .returning()
        .all()

      if (updated.length === 0) {
        throw new Error('Invoice not found')
      }

      if (normalizedLineItems) {
        tx.delete(schema.invoice_line_item)
          .where(eq(schema.invoice_line_item.invoice_id, input.id))
          .run()

        for (const item of normalizedLineItems) {
          tx.insert(schema.invoice_line_item)
            .values({
              invoice_id: input.id,
              position: item.position,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              unit_price_net: item.unitPriceNet,
              line_net_amount: item.lineNetAmount,
              tax_rate: item.taxRate,
              tax_code: item.taxCode,
              line_tax_amount: item.lineTaxAmount,
              line_gross_amount: item.lineGrossAmount
            })
            .run()
        }
      }

      return this.loadInvoiceWithRelationsTx(tx, input.id)
    })
  }

  /** Records that the invoice's email was created (not a content change) */
  markEmailed(id: number, to: string) {
    db.update(schema.invoice)
      .set({ emailed_at: sql`datetime('now')`, emailed_to: to })
      .where(eq(schema.invoice.id, id))
      .run()
  }

  /** Changes only the status; assigns the number when a draft is issued */
  async setStatus(id: number, status: InvoiceStatus) {
    return db.transaction((tx) => {
      const existing = tx
        .select()
        .from(schema.invoice)
        .where(eq(schema.invoice.id, id))
        .limit(1)
        .all()[0]
      if (!existing) throw new Error('Invoice not found')

      const values: Record<string, unknown> = { status, updated_at: sql`datetime('now')` }
      if (status !== 'draft' && existing.invoice_number === null) {
        this.assertIssuable(existing.total_gross_amount)
        values.invoice_number = this.takeNextInvoiceNumber(tx, existing.company_id)
        Object.assign(values, this.issueSnapshotIds(tx, existing))
      }

      tx.update(schema.invoice).set(values).where(eq(schema.invoice.id, id)).run()
      if (
        status === 'cancelled' &&
        existing.kind === 'invoice' &&
        existing.invoice_number !== null
      ) {
        this.createCancellationTx(tx, existing)
      }
      return this.loadInvoiceWithRelationsTx(tx, id)
    })
  }

  /**
   * The Stornorechnung of a cancelled invoice: its own next number, the
   * same (frozen) parties and lines with negated quantities and amounts, so
   * the two add up to zero. Issued right away; it never changes.
   */
  private createCancellationTx(tx: Tx, original: InvoiceRow) {
    const lines = tx
      .select()
      .from(schema.invoice_line_item)
      .where(eq(schema.invoice_line_item.invoice_id, original.id))
      .orderBy(asc(schema.invoice_line_item.position), asc(schema.invoice_line_item.id))
      .all()

    const [created] = tx
      .insert(schema.invoice)
      .values({
        invoice_number: this.takeNextInvoiceNumber(tx, original.company_id),
        company_id: original.company_id,
        issuer_snapshot_id: original.issuer_snapshot_id,
        recipient_snapshot_id: original.recipient_snapshot_id,
        deal_memo_id: original.deal_memo_id,
        period_start_date: original.period_start_date,
        period_end_date: original.period_end_date,
        period_label: original.period_label,
        issue_date: new Date().toISOString().slice(0, 10),
        due_date: null,
        status: 'issued',
        currency: original.currency,
        subtotal_net_amount: -original.subtotal_net_amount,
        subtotal_tax_amount: -original.subtotal_tax_amount,
        total_gross_amount: -original.total_gross_amount,
        total_amount: -original.total_amount,
        payment_terms: `Storno der Rechnung Nr. ${original.invoice_number} vom ${germanDate(original.issue_date)}`,
        reverse_charge_note: original.reverse_charge_note,
        buyer_reference: original.buyer_reference,
        xrechnung: original.xrechnung,
        kind: 'cancellation',
        cancels_invoice_id: original.id,
        notes: ''
      })
      .returning()
      .all()

    for (const line of lines) {
      tx.insert(schema.invoice_line_item)
        .values({
          invoice_id: created.id,
          position: line.position,
          description: line.description,
          quantity: -line.quantity,
          unit: line.unit,
          unit_price_net: line.unit_price_net,
          line_net_amount: -line.line_net_amount,
          tax_rate: line.tax_rate,
          tax_code: line.tax_code,
          line_tax_amount: -line.line_tax_amount,
          line_gross_amount: -line.line_gross_amount
        })
        .run()
    }
    return created
  }

  async delete(id: number) {
    await db.delete(schema.invoice).where(eq(schema.invoice.id, id))
  }

  async getByDealMemoId(dealMemoId: number) {
    const rows = await db
      .select()
      .from(schema.invoice)
      .leftJoin(schema.company, eq(schema.invoice.company_id, schema.company.id))
      .leftJoin(schema.deal_memo, eq(schema.invoice.deal_memo_id, schema.deal_memo.id))
      .leftJoin(
        schema.invoice_party_snapshot,
        eq(schema.invoice.recipient_snapshot_id, schema.invoice_party_snapshot.id)
      )
      .where(eq(schema.invoice.deal_memo_id, dealMemoId))
      .orderBy(desc(schema.invoice.created_at), desc(schema.invoice.id))

    return this.withCancellationLinks(
      db,
      rows.map((row) => ({
        ...row.invoice,
        company: row.company,
        dealMemo: row.deal_memo,
        recipientSnapshot: row.invoice_party_snapshot,
        lineItems: []
      }))
    )
  }

  /**
   * Invoices a company issued (invoice.company_id) or received (recipient
   * snapshot taken from that company), newest first
   */
  async listByCompany(companyId: number) {
    return this.listWhere(
      or(
        eq(schema.invoice.company_id, companyId),
        eq(schema.invoice_party_snapshot.source_company_id, companyId)
      )
    )
  }

  /** Invoices addressed to a person (recipient snapshot taken from that person), newest first */
  async listByRecipientPerson(personId: number) {
    return this.listWhere(eq(schema.invoice_party_snapshot.source_person_id, personId))
  }

  /** Invoices matching `where` (may filter on the recipient snapshot), newest first */
  private async listWhere(where: SQL | undefined) {
    const rows = await db
      .select()
      .from(schema.invoice)
      .leftJoin(schema.company, eq(schema.invoice.company_id, schema.company.id))
      .leftJoin(schema.deal_memo, eq(schema.invoice.deal_memo_id, schema.deal_memo.id))
      .leftJoin(
        schema.invoice_party_snapshot,
        eq(schema.invoice.recipient_snapshot_id, schema.invoice_party_snapshot.id)
      )
      .where(where)
      .orderBy(desc(schema.invoice.issue_date), desc(schema.invoice.id))

    return this.withCancellationLinks(
      db,
      rows.map((row) => ({
        ...row.invoice,
        company: row.company,
        dealMemo: row.deal_memo,
        recipientSnapshot: row.invoice_party_snapshot,
        lineItems: []
      }))
    )
  }

  async findByCompanyAndInvoiceNumber(companyId: number, invoiceNumber: number) {
    const rows = await db
      .select()
      .from(schema.invoice)
      .where(
        and(
          eq(schema.invoice.company_id, companyId),
          eq(schema.invoice.invoice_number, invoiceNumber)
        )
      )
      .limit(1)

    return rows[0] ?? null
  }
}
