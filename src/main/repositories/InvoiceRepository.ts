import { injectable } from 'tsyringe'
import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import { alias } from 'drizzle-orm/sqlite-core'
import type {
  CreateInvoiceInput,
  CreateInvoiceForDealMemoInput,
  InvoiceLineItemInput,
  InvoiceRecipientKind,
  UpsertCompanyInvoiceSettingsInput,
  UpdateInvoiceInput
} from '../api/schemas/invoice.schema'
import type { PaginationInput } from '../api/schemas/base.schema'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

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
  private roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100
  }

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
              taxCode: 'other'
            }
          ]

    return source.map((item, index) => {
      const quantity = item.quantity ?? 1
      const unit = item.unit ?? 'service'
      const taxRate = item.taxRate ?? 0
      const unitPriceNet = item.unitPriceNet
      const lineNetAmount = this.roundMoney(quantity * unitPriceNet)
      const lineTaxAmount = this.roundMoney((lineNetAmount * taxRate) / 100)
      const lineGrossAmount = this.roundMoney(lineNetAmount + lineTaxAmount)

      return {
        position: index + 1,
        description: item.description,
        quantity,
        unit,
        unitPriceNet,
        taxRate,
        taxCode: item.taxCode ?? 'standard',
        lineNetAmount,
        lineTaxAmount,
        lineGrossAmount
      }
    })
  }

  private sumTotals(normalizedLineItems: ReturnType<InvoiceRepository['normalizeLineItems']>) {
    const subtotalNetAmount = this.roundMoney(
      normalizedLineItems.reduce((sum, item) => sum + item.lineNetAmount, 0)
    )
    const subtotalTaxAmount = this.roundMoney(
      normalizedLineItems.reduce((sum, item) => sum + item.lineTaxAmount, 0)
    )
    const totalGrossAmount = this.roundMoney(subtotalNetAmount + subtotalTaxAmount)

    return {
      subtotalNetAmount,
      subtotalTaxAmount,
      totalGrossAmount
    }
  }

  private createManualSnapshot(tx: Tx, kind: InvoiceRecipientKind, legalName: string) {
    const rows = tx
      .insert(schema.invoice_party_snapshot)
      .values({
        kind,
        legal_name: legalName
      })
      .returning()
      .all()

    if (rows.length === 0) {
      throw new Error('Failed to create party snapshot')
    }

    return rows[0]
  }

  private createCompanySnapshot(tx: Tx, companyId: number) {
    const rows = tx
      .select({
        company: schema.company,
        address: schema.address,
        contact: schema.contact,
        bank: schema.bank
      })
      .from(schema.company)
      .leftJoin(schema.address, eq(schema.company.address_id, schema.address.id))
      .leftJoin(schema.contact, eq(schema.company.contact_id, schema.contact.id))
      .leftJoin(schema.bank, eq(schema.company.bank_id, schema.bank.id))
      .where(eq(schema.company.id, companyId))
      .limit(1)
      .all()

    if (rows.length === 0) {
      throw new Error('Company not found')
    }

    const row = rows[0]
    const inserted = tx
      .insert(schema.invoice_party_snapshot)
      .values({
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
        website: row.company.website,
        account_holder: row.bank?.account_holder ?? '',
        bank_name: row.bank?.bank_name ?? '',
        email: row.contact?.email ?? '',
        phone: row.contact?.phone ?? row.contact?.mobile_phone ?? '',
        iban: row.bank?.iban ?? '',
        bic: row.bank?.bic ?? ''
      })
      .returning()
      .all()

    if (inserted.length === 0) {
      throw new Error('Failed to create company snapshot')
    }

    return inserted[0]
  }

  private createBandSnapshot(tx: Tx, bandId: number) {
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
    const inserted = tx
      .insert(schema.invoice_party_snapshot)
      .values({
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
      })
      .returning()
      .all()

    if (inserted.length === 0) {
      throw new Error('Failed to create band snapshot')
    }

    return inserted[0]
  }

  private createPersonSnapshot(tx: Tx, personId: number) {
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
    const inserted = tx
      .insert(schema.invoice_party_snapshot)
      .values({
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
      })
      .returning()
      .all()

    if (inserted.length === 0) {
      throw new Error('Failed to create person snapshot')
    }

    return inserted[0]
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
      throw new Error('No invoicing company configured. Set a default company or pick one explicitly.')
    }

    return defaultCompany[0].id
  }

  private resolveRecipientSnapshot(tx: Tx, input: RecipientSnapshotInput, issuerCompanyId: number) {
    const kind = input.recipientKind

    if (kind === 'company') {
      const recipientCompanyId = input.recipientCompanyId ?? input.companyId ?? issuerCompanyId
      return this.createCompanySnapshot(tx, recipientCompanyId)
    }

    if (kind === 'band') {
      if (!input.recipientBandId) {
        throw new Error('recipientBandId is required when recipientKind is band')
      }
      return this.createBandSnapshot(tx, input.recipientBandId)
    }

    if (kind === 'person') {
      if (!input.recipientPersonId) {
        throw new Error('recipientPersonId is required when recipientKind is person')
      }
      return this.createPersonSnapshot(tx, input.recipientPersonId)
    }

    if (kind === 'other') {
      const manualName = input.recipientNameOverride?.trim()
      if (!manualName) {
        throw new Error('recipientNameOverride is required when recipientKind is other')
      }
      return this.createManualSnapshot(tx, 'other', manualName)
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
          return this.createCompanySnapshot(tx, memoRows[0].loProCompanyId)
        }

        if (memoRows[0].bandId) {
          return this.createBandSnapshot(tx, memoRows[0].bandId)
        }
      }
    }

    return this.createCompanySnapshot(tx, issuerCompanyId)
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
    return {
      ...row.invoice,
      company: row.company,
      dealMemo: row.deal_memo,
      recipientSnapshot: row.invoice_party_snapshot,
      lineItems
    }
  }

  async getAllPaginated(pagination: PaginationInput) {
    const { page, pageSize, search } = pagination
    const offset = (page - 1) * pageSize

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
      .orderBy(desc(schema.invoice.created_at), desc(schema.invoice.id))
      .limit(pageSize)
      .offset(offset)

    const items = rows.map((row) => ({
      ...row.invoice,
      company: row.company,
      dealMemo: row.deal_memo,
      recipientSnapshot: row.invoice_party_snapshot,
      lineItems: []
    }))

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
    return {
      ...row.invoice,
      company: row.company,
      dealMemo: row.deal_memo,
      recipientSnapshot: row.invoice_party_snapshot,
      lineItems
    }
  }

  async getByIdWithSnapshots(id: number) {
    const issuerSnapshot = alias(schema.invoice_party_snapshot, 'issuer_snapshot')
    const recipientSnapshot = alias(schema.invoice_party_snapshot, 'recipient_snapshot')

    const rows = await db
      .select()
      .from(schema.invoice)
      .leftJoin(schema.company, eq(schema.invoice.company_id, schema.company.id))
      .leftJoin(schema.deal_memo, eq(schema.invoice.deal_memo_id, schema.deal_memo.id))
      .leftJoin(schema.venue, eq(schema.deal_memo.venue_id, schema.venue.id))
      .leftJoin(issuerSnapshot, eq(schema.invoice.issuer_snapshot_id, issuerSnapshot.id))
      .leftJoin(recipientSnapshot, eq(schema.invoice.recipient_snapshot_id, recipientSnapshot.id))
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
    return {
      ...row.invoice,
      company: row.company,
      dealMemo: row.deal_memo,
      venueName: row.venue?.name ?? null,
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

  async create(input: CreateInvoiceInput) {
    return db.transaction((tx) => {
      const companyId = this.resolveInvoiceCompanyId(tx, input)
      const issuerSnapshot = this.createCompanySnapshot(tx, companyId)
      const recipientSnapshot = this.resolveRecipientSnapshot(tx, input, companyId)
      const normalizedLineItems = this.normalizeLineItems(input.lineItems, input.totalAmount)
      const totals = this.sumTotals(normalizedLineItems)

      const existingSettings = tx
        .select()
        .from(schema.company_invoice_settings)
        .where(eq(schema.company_invoice_settings.company_id, companyId))
        .limit(1)
        .all()

      const assignedInvoiceNumber = existingSettings[0]?.next_invoice_number ?? 1

      if (existingSettings.length > 0) {
        tx
          .update(schema.company_invoice_settings)
          .set({
            next_invoice_number: assignedInvoiceNumber + 1,
            updated_at: sql`datetime('now')`
          })
          .where(eq(schema.company_invoice_settings.id, existingSettings[0].id))
          .run()
      } else {
        tx.insert(schema.company_invoice_settings).values({
          company_id: companyId,
          next_invoice_number: assignedInvoiceNumber + 1
        }).run()
      }

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
          status: input.status ?? 'draft',
          currency: input.currency ?? 'EUR',
          subtotal_net_amount: totals.subtotalNetAmount,
          subtotal_tax_amount: totals.subtotalTaxAmount,
          total_gross_amount: totals.totalGrossAmount,
          total_amount: totals.totalGrossAmount,
          payment_terms: input.paymentTerms ?? '',
          reverse_charge_note: input.reverseChargeNote ?? '',
          notes: input.notes ?? ''
        })
        .returning()
        .all()

      if (created.length === 0) {
        throw new Error('Failed to create invoice record')
      }

      const invoiceId = created[0].id

      for (const item of normalizedLineItems) {
        tx
          .insert(schema.invoice_line_item)
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
    })
  }

  async createForDealMemo(input: CreateInvoiceForDealMemoInput) {
    return this.create(input)
  }

  async update(input: UpdateInvoiceInput) {
    const normalizedLineItems =
      'lineItems' in input && input.lineItems
        ? this.normalizeLineItems(input.lineItems, input.totalAmount)
        : null

    const computedTotals = normalizedLineItems ? this.sumTotals(normalizedLineItems) : null

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
              'dealMemoId' in input
                ? (input.dealMemoId ?? null)
                : (existing.deal_memo_id ?? null),
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
        tx.delete(schema.invoice_line_item).where(eq(schema.invoice_line_item.invoice_id, input.id)).run()

        for (const item of normalizedLineItems) {
          tx
            .insert(schema.invoice_line_item)
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

    return rows.map((row) => ({
      ...row.invoice,
      company: row.company,
      dealMemo: row.deal_memo,
      recipientSnapshot: row.invoice_party_snapshot,
      lineItems: []
    }))
  }

  async findByCompanyAndInvoiceNumber(companyId: number, invoiceNumber: number) {
    const rows = await db
      .select()
      .from(schema.invoice)
      .where(
        and(eq(schema.invoice.company_id, companyId), eq(schema.invoice.invoice_number, invoiceNumber))
      )
      .limit(1)

    return rows[0] ?? null
  }
}
