import { injectable } from 'tsyringe'
import { and, asc, desc, eq, inArray, like, ne, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { listOrder, listPage } from './listQuery'
import { db } from '../db'
import { schema } from '../db/schema'
import type {
  CreateInvoiceInput,
  InvoiceRecipientKind,
  InvoiceStatus,
  UpdateInvoiceInput
} from '../api/schemas/invoice.schema'
import type { PaginationInput } from '../api/schemas/base.schema'
import { toCents } from '../einvoice/amounts'
import type { Tx } from './tx'
import { createCancellationTx } from './invoice/cancellation'
import { listEmails, listStatusChanges, logStatusTx } from './invoice/history'
import {
  insertLineItems,
  lineItemsOf,
  normalizeLineItems,
  type NormalizedLineItems
} from './invoice/lineItems'
import { assertIssuable, claimDatevInvoiceNumber, takeNextInvoiceNumber } from './invoice/numbering'
import {
  createCompanySnapshot,
  insertSnapshot,
  issueSnapshotIds,
  resolveInvoiceCompanyId,
  resolveRecipientSnapshot,
  resolveRecipientValues,
  withCustomerNumberTx
} from './invoice/partySnapshots'
import {
  invoiceEntity,
  invoicesWithParties,
  overdueInvoiceWhere,
  withCancellationLinks
} from './invoice/queries'

/**
 * Invoices: reading them with their parties, creating, editing and the
 * status lifecycle (numbering on issue, Stornorechnung on cancel). The
 * parts live in `./invoice/`; emails, settings and the e-invoice party
 * preview have their own repositories.
 */

/** The invoice columns an update writes, from the fields present in the input */
function updateValues(
  input: UpdateInvoiceInput,
  computedTotals: NormalizedLineItems['totals'] | null
): Record<string, unknown> {
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
    values.subtotal_net_cents = computedTotals.subtotalNetCents
    values.subtotal_tax_cents = computedTotals.subtotalTaxCents
    values.total_gross_cents = computedTotals.totalGrossCents
  } else if ('totalAmount' in input && input.totalAmount !== undefined) {
    values.total_gross_cents = toCents(input.totalAmount)
  }
  if ('paymentTerms' in input) values.payment_terms = input.paymentTerms
  if ('reverseChargeNote' in input) values.reverse_charge_note = input.reverseChargeNote
  if ('buyerReference' in input) values.buyer_reference = input.buyerReference
  if ('xrechnung' in input) values.xrechnung = input.xrechnung
  if ('notes' in input) values.notes = input.notes
  return values
}

/** Whether an update changes who receives the invoice (or the event it may come from) */
function touchesRecipient(input: UpdateInvoiceInput): boolean {
  return (
    'recipientKind' in input ||
    'recipientCompanyId' in input ||
    'recipientBandId' in input ||
    'recipientPersonId' in input ||
    'recipientNameOverride' in input ||
    'dealMemoId' in input
  )
}

@injectable()
export class InvoiceRepository {
  private loadInvoiceWithRelationsTx(tx: Tx, invoiceId: number) {
    const row = invoicesWithParties(tx).where(eq(schema.invoice.id, invoiceId)).limit(1).all()[0]
    if (!row) {
      throw new Error('Rechnung nicht gefunden')
    }

    return withCancellationLinks(tx, [
      {
        ...invoiceEntity(row, lineItemsOf(tx, invoiceId)),
        emails: listEmails(tx, invoiceId),
        statusChanges: listStatusChanges(tx, invoiceId)
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

    const rows = invoicesWithParties(db)
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
            totalAmount: [schema.invoice.total_gross_cents]
          },
          { key: 'issueDate', dir: 'desc' },
          schema.invoice.id
        )
      )
      .limit(pageSize)
      .offset(offset)
      .all()

    return {
      items: withCancellationLinks(
        db,
        rows.map((row) => invoiceEntity(row))
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }
  }

  async getById(id: number) {
    const row = invoicesWithParties(db).where(eq(schema.invoice.id, id)).limit(1).all()[0]
    if (!row) {
      return null
    }

    return withCancellationLinks(db, [
      {
        ...invoiceEntity(row, lineItemsOf(db, id)),
        emails: listEmails(db, id),
        statusChanges: listStatusChanges(db, id)
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

    const row = rows[0]
    const [links] = withCancellationLinks(db, [row.invoice])
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
      lineItems: lineItemsOf(db, id)
    }
  }

  async create(input: CreateInvoiceInput) {
    return db.transaction((tx) => this.createTx(tx, input))
  }

  /** Creates an invoice inside a caller's transaction (e.g. with records that point to it) */
  createTx(tx: Tx, input: CreateInvoiceInput) {
    const companyId = resolveInvoiceCompanyId(tx, input)
    const issuerSnapshot = createCompanySnapshot(tx, companyId)
    const recipientValues = resolveRecipientValues(tx, input, companyId)
    // An invoice issued right away gives its recipient a Kundennummer like an issued draft
    const recipientSnapshot = insertSnapshot(
      tx,
      (input.status ?? 'draft') === 'draft'
        ? recipientValues
        : withCustomerNumberTx(tx, recipientValues)
    )
    const { items: normalizedLineItems, totals } = normalizeLineItems(
      input.lineItems,
      input.totalAmount
    )

    const status = input.status ?? 'draft'
    const issueDate = input.issueDate ?? new Date().toISOString().slice(0, 10)
    // Drafts get their number when they are issued
    if (status !== 'draft') assertIssuable(totals.totalGrossCents)
    const fromDatev = input.createdInDatev === true && status !== 'draft'
    if (fromDatev && !input.datevInvoiceNumber) {
      throw new Error('Bitte die Rechnungsnummer aus DATEV eintragen.')
    }
    const assignedInvoiceNumber =
      status === 'draft'
        ? null
        : fromDatev
          ? claimDatevInvoiceNumber(tx, companyId, input.datevInvoiceNumber as number)
          : takeNextInvoiceNumber(tx, companyId, issueDate)

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
        issue_date: issueDate,
        due_date: input.dueDate ?? null,
        status,
        currency: input.currency ?? 'EUR',
        subtotal_net_cents: totals.subtotalNetCents,
        subtotal_tax_cents: totals.subtotalTaxCents,
        total_gross_cents: totals.totalGrossCents,
        payment_terms: input.paymentTerms ?? '',
        reverse_charge_note: input.reverseChargeNote ?? '',
        buyer_reference: input.buyerReference ?? '',
        xrechnung: input.xrechnung ?? false,
        notes: input.notes ?? '',
        created_in_datev: fromDatev
      })
      .returning()
      .all()

    if (created.length === 0) {
      throw new Error('Failed to create invoice record')
    }

    const invoiceId = created[0].id
    if (status !== 'draft') logStatusTx(tx, invoiceId, status)
    insertLineItems(tx, invoiceId, normalizedLineItems)

    return this.loadInvoiceWithRelationsTx(tx, invoiceId)
  }

  async update(input: UpdateInvoiceInput) {
    const normalized =
      'lineItems' in input && input.lineItems
        ? normalizeLineItems(input.lineItems, input.totalAmount)
        : null
    const values = updateValues(input, normalized?.totals ?? null)

    return db.transaction((tx) => {
      const existing = tx
        .select()
        .from(schema.invoice)
        .where(eq(schema.invoice.id, input.id))
        .limit(1)
        .all()[0]
      if (!existing) {
        throw new Error('Rechnung nicht gefunden')
      }

      if ('dealMemoId' in input) {
        values.deal_memo_id = input.dealMemoId ?? null
      }

      const nextCompanyId = input.companyId ?? existing.company_id
      if ('companyId' in input) {
        values.company_id = nextCompanyId
        values.issuer_snapshot_id = createCompanySnapshot(tx, nextCompanyId).id
      }

      if (touchesRecipient(input)) {
        const inferredKind: InvoiceRecipientKind | undefined =
          input.recipientKind ??
          (input.recipientBandId ? 'band' : undefined) ??
          (input.recipientPersonId ? 'person' : undefined) ??
          (input.recipientCompanyId ? 'company' : undefined) ??
          (input.recipientNameOverride ? 'other' : undefined)

        const recipientSnapshot = resolveRecipientSnapshot(
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
        assertIssuable(
          (values.total_gross_cents as number | undefined) ?? existing.total_gross_cents
        )
        if (input.createdInDatev === true) {
          // #246: written in DATEV, issued here with DATEV's number
          if (!input.datevInvoiceNumber) {
            throw new Error('Bitte die Rechnungsnummer aus DATEV eintragen.')
          }
          values.invoice_number = claimDatevInvoiceNumber(
            tx,
            nextCompanyId,
            input.datevInvoiceNumber,
            existing.id
          )
          values.created_in_datev = true
        } else {
          values.invoice_number = takeNextInvoiceNumber(
            tx,
            nextCompanyId,
            (values.issue_date as string | undefined) ?? existing.issue_date
          )
        }
        Object.assign(
          values,
          issueSnapshotIds(tx, {
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
        throw new Error('Rechnung nicht gefunden')
      }
      if (values.status !== undefined && values.status !== existing.status) {
        logStatusTx(tx, input.id, values.status as InvoiceStatus)
      }

      if (normalized) {
        tx.delete(schema.invoice_line_item)
          .where(eq(schema.invoice_line_item.invoice_id, input.id))
          .run()
        insertLineItems(tx, input.id, normalized.items)
      }

      return this.loadInvoiceWithRelationsTx(tx, input.id)
    })
  }

  /**
   * #246: marks an issued invoice as written in DATEV (or not). With a number it also takes
   * DATEV's number, but only while the invoice has gone nowhere yet: no mail, no hand-over.
   */
  async setCreatedInDatev(id: number, createdInDatev: boolean, invoiceNumber?: number | null) {
    return db.transaction((tx) => {
      const existing = tx.select().from(schema.invoice).where(eq(schema.invoice.id, id)).get()
      if (!existing) throw new Error('Rechnung nicht gefunden')
      if (existing.invoice_number === null) {
        throw new Error('Ein Entwurf wird beim Stellen als „In DATEV erstellt“ markiert.')
      }
      const values: Record<string, unknown> = {
        created_in_datev: createdInDatev,
        updated_at: sql`datetime('now')`
      }
      if (createdInDatev && invoiceNumber && invoiceNumber !== existing.invoice_number) {
        const handedOver = tx
          .select({ id: schema.datev_transfer.id })
          .from(schema.datev_transfer)
          .where(eq(schema.datev_transfer.invoice_id, id))
          .get()
        if (existing.emailed_at !== null || handedOver) {
          throw new Error(
            'Die Rechnung wurde schon verschickt oder an DATEV übergeben; ihre Nummer bleibt.'
          )
        }
        values.invoice_number = claimDatevInvoiceNumber(
          tx,
          existing.company_id,
          invoiceNumber,
          existing.id
        )
      }
      tx.update(schema.invoice).set(values).where(eq(schema.invoice.id, id)).run()
      return this.loadInvoiceWithRelationsTx(tx, id)
    })
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
      if (!existing) throw new Error('Rechnung nicht gefunden')

      const values: Record<string, unknown> = { status, updated_at: sql`datetime('now')` }
      if (status !== 'draft' && existing.invoice_number === null) {
        assertIssuable(existing.total_gross_cents)
        values.invoice_number = takeNextInvoiceNumber(tx, existing.company_id, existing.issue_date)
        Object.assign(values, issueSnapshotIds(tx, existing))
      }

      tx.update(schema.invoice).set(values).where(eq(schema.invoice.id, id)).run()
      if (status !== existing.status) logStatusTx(tx, id, status)
      if (
        status === 'cancelled' &&
        existing.kind === 'invoice' &&
        existing.invoice_number !== null
      ) {
        createCancellationTx(tx, existing)
      }
      return this.loadInvoiceWithRelationsTx(tx, id)
    })
  }

  async delete(id: number) {
    await db.delete(schema.invoice).where(eq(schema.invoice.id, id))
  }

  async getByDealMemoId(dealMemoId: number) {
    return this.listWhere(eq(schema.invoice.deal_memo_id, dealMemoId), [
      desc(schema.invoice.created_at),
      desc(schema.invoice.id)
    ])
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

  /**
   * Invoices of a band: those for its events (deal_memo.band_id) and those
   * addressed to it (recipient snapshot taken from that band), newest first
   */
  async listByBand(bandId: number) {
    return this.listWhere(
      or(
        eq(schema.deal_memo.band_id, bandId),
        eq(schema.invoice_party_snapshot.source_band_id, bandId)
      )
    )
  }

  /** Invoices addressed to a person (recipient snapshot taken from that person), newest first */
  async listByRecipientPerson(personId: number) {
    return this.listWhere(eq(schema.invoice_party_snapshot.source_person_id, personId))
  }

  /**
   * Overdue invoices, longest overdue first, each with the payment reminders
   * sent so far (oldest first)
   */
  async listOverdue(today: string) {
    const invoices = await this.listWhere(overdueInvoiceWhere(today), [
      asc(sql`coalesce(${schema.invoice.due_date}, ${schema.invoice.issue_date})`),
      asc(schema.invoice.id)
    ])
    const reminders =
      invoices.length === 0
        ? []
        : db
            .select()
            .from(schema.invoice_email)
            .where(
              and(
                inArray(
                  schema.invoice_email.invoice_id,
                  invoices.map((invoice) => invoice.id)
                ),
                ne(schema.invoice_email.kind, 'invoice')
              )
            )
            .orderBy(asc(schema.invoice_email.created_at), asc(schema.invoice_email.id))
            .all()
    return invoices.map((invoice) => ({
      ...invoice,
      emails: reminders.filter((email) => email.invoice_id === invoice.id)
    }))
  }

  /** Invoices matching `where` (may filter on the recipient snapshot), newest first */
  private async listWhere(
    where: SQL | undefined,
    orderBy: SQL[] = [desc(schema.invoice.issue_date), desc(schema.invoice.id)]
  ) {
    const rows = invoicesWithParties(db)
      .where(where)
      .orderBy(...orderBy)
      .all()
    return withCancellationLinks(
      db,
      rows.map((row) => invoiceEntity(row))
    )
  }
}
