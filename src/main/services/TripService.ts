import { inject, injectable } from 'tsyringe'
import { TripRepository } from '../repositories/TripRepository'
import { ReceiptRepository } from '../repositories/ReceiptRepository'
import { ReceiptService } from './ReceiptService'
import {
  DOMESTIC_RATES,
  tripAllowances,
  tripTimesError,
  type TripMeals
} from '../travel/allowances'
import { buildTripReport, receiptsTotalCents } from '../travel/tripReport'
import { receiptFileName } from '../receipts/receiptFiles'
import { storeReceiptFile } from '../utils/receiptStorage'
import { deleteDocumentFile } from '../utils/fileStorage'
import type { ReceiptCategory } from '../api/schemas/receipt.schema'
import type { TripDto, TripFields, TripVehicle, UpdateTripInput } from '../api/schemas/trip.schema'

type TripRow = NonNullable<ReturnType<TripRepository['getById']>>

function mealsOf(raw: string): Record<string, TripMeals> {
  try {
    const parsed = JSON.parse(raw) as Record<string, TripMeals>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** #225 step 2: business trips, their allowances and the report that goes to DATEV */
@injectable()
export class TripService {
  constructor(
    @inject(TripRepository) private repository: TripRepository,
    @inject(ReceiptRepository) private receiptRepository: ReceiptRepository,
    @inject(ReceiptService) private receipts: ReceiptService
  ) {}

  private columns(fields: TripFields) {
    const error = tripTimesError(fields.startAt, fields.endAt)
    if (error) throw new Error(error)
    // Meals only for days of the trip
    const days = new Set(
      tripAllowances({ ...this.inputOf(fields), meals: {} }).days.map((day) => day.date)
    )
    const meals = Object.fromEntries(
      Object.entries(fields.meals).filter(
        ([date, meal]) => days.has(date) && (meal.breakfast || meal.lunch || meal.dinner)
      )
    )
    return {
      person_id: fields.personId,
      traveller_name: fields.travellerName,
      purpose: fields.purpose,
      destination: fields.destination,
      country_code: fields.countryCode,
      start_at: fields.startAt,
      end_at: fields.endAt,
      overnight: fields.overnight,
      rate_partial_cents: fields.ratePartialCents,
      rate_full_cents: fields.rateFullCents,
      kilometres: fields.kilometres,
      vehicle: fields.vehicle,
      meals: JSON.stringify(meals),
      category: fields.category,
      notes: fields.notes
    }
  }

  private inputOf(fields: TripFields) {
    return {
      startAt: fields.startAt,
      endAt: fields.endAt,
      overnight: fields.overnight,
      rates:
        fields.ratePartialCents !== null && fields.rateFullCents !== null
          ? { partialCents: fields.ratePartialCents, fullCents: fields.rateFullCents }
          : DOMESTIC_RATES,
      meals: fields.meals,
      kilometres: fields.kilometres,
      vehicle: fields.vehicle
    }
  }

  private fieldsOf(row: TripRow): TripFields {
    const t = row.trip
    return {
      companyId: t.company_id,
      personId: t.person_id,
      travellerName: t.traveller_name,
      purpose: t.purpose,
      destination: t.destination,
      countryCode: t.country_code,
      startAt: t.start_at,
      endAt: t.end_at,
      overnight: t.overnight,
      ratePartialCents: t.rate_partial_cents,
      rateFullCents: t.rate_full_cents,
      kilometres: t.kilometres,
      vehicle: t.vehicle as TripVehicle,
      meals: mealsOf(t.meals),
      category: t.category as ReceiptCategory,
      notes: t.notes
    }
  }

  private toDto(row: TripRow): TripDto {
    const fields = this.fieldsOf(row)
    const allowances = tripAllowances(this.inputOf(fields))
    const receipts = this.repository
      .receipts(row.trip.id)
      .map(({ receipt, supplierCompanyName }) => ({
        id: receipt.id,
        receiptDate: receipt.receipt_date,
        supplierName: supplierCompanyName ?? receipt.supplier_name,
        fileName: receipt.file_name,
        amountCents: receipt.amount_cents,
        currency: receipt.currency
      }))
    const receiptsCents = receiptsTotalCents(
      receipts.map((r) => ({ ...r, date: r.receiptDate, label: r.fileName, pdf: null }))
    )
    const report = this.repository.report(row.trip.id)
    return {
      ...fields,
      id: row.trip.id,
      companyName: row.companyName ?? '',
      receipts,
      allowancesCents: allowances.allowancesCents,
      mileageCents: allowances.mileageCents,
      receiptsCents,
      totalCents: allowances.allowancesCents + allowances.mileageCents + receiptsCents,
      report: report
        ? {
            receiptId: report.receipt.id,
            fileName: report.receipt.file_name,
            datev: report.sent ? 'sent' : report.any ? 'pending' : 'none',
            createdAt: report.receipt.updated_at
          }
        : null,
      updatedAt: row.trip.updated_at
    }
  }

  list(): TripDto[] {
    return this.repository.list().map((row) => this.toDto(row))
  }

  get(id: number): TripDto | null {
    const row = this.repository.getById(id)
    return row ? this.toDto(row) : null
  }

  create(fields: TripFields): TripDto {
    const id = this.repository.create({
      ...this.columns(fields),
      company_id: fields.companyId ?? this.receiptRepository.defaultCompanyId()
    })
    return this.get(id)!
  }

  update(input: UpdateTripInput): TripDto {
    const row = this.repository.getById(input.id)
    if (!row) throw new Error('Reise nicht gefunden')
    this.repository.update(input.id, {
      ...this.columns(input),
      // "Default" in the form keeps the stored company
      company_id: input.companyId ?? row.trip.company_id
    })
    return this.get(input.id)!
  }

  delete(id: number): void {
    this.repository.delete(id)
  }

  unassignedReceipts() {
    return this.repository.unassignedReceipts().map(({ receipt, supplierCompanyName }) => ({
      id: receipt.id,
      receiptDate: receipt.receipt_date,
      supplierName: supplierCompanyName ?? receipt.supplier_name,
      fileName: receipt.file_name,
      amountCents: receipt.amount_cents,
      currency: receipt.currency
    }))
  }

  assignReceipt(receiptId: number, tripId: number | null): void {
    if (tripId !== null && !this.repository.getById(tripId)) throw new Error('Reise nicht gefunden')
    this.repository.assignReceipt(receiptId, tripId)
  }

  /**
   * Builds the report PDF (summary and the receipts' pages) and stores it as the trip's report
   * receipt, created on the first call and replaced on later ones; returns its receipt id
   */
  async buildReport(id: number): Promise<number> {
    const row = this.repository.getById(id)
    if (!row) throw new Error('Reise nicht gefunden')
    const trip = this.toDto(row)
    const receipts = await Promise.all(
      this.repository.receipts(id).map(async ({ receipt, supplierCompanyName }) => {
        const file = await this.receipts.fileBytes(receipt.id).catch(() => null)
        return {
          date: receipt.receipt_date,
          label:
            [supplierCompanyName ?? receipt.supplier_name, receipt.reference]
              .filter(Boolean)
              .join(' · ') || receipt.file_name,
          amountCents: receipt.amount_cents,
          currency: receipt.currency,
          pdf: file && file.contentType === 'application/pdf' ? file.bytes : null
        }
      })
    )
    const pdf = await buildTripReport({
      companyName: trip.companyName,
      travellerName: trip.travellerName,
      purpose: trip.purpose,
      destination: trip.destination,
      countryCode: trip.countryCode,
      startAt: trip.startAt,
      endAt: trip.endAt,
      kilometres: trip.kilometres,
      vehicle: trip.vehicle,
      allowances: tripAllowances(this.inputOf(trip)),
      receipts,
      notes: trip.notes
    })
    const endDate = trip.endAt.slice(0, 10)
    const fileName = receiptFileName(
      ['Reisekosten', trip.startAt.slice(0, 10), trip.travellerName, trip.destination]
        .filter(Boolean)
        .join(' '),
      'pdf'
    )
    const columns = {
      category: trip.category,
      receipt_date: endDate,
      amount_cents: trip.totalCents,
      currency: 'EUR',
      supplier_name: trip.travellerName,
      reference: 'Reisekostenabrechnung',
      file_name: fileName
    }
    const existing = this.repository.report(id)
    if (existing) {
      const stored = await storeReceiptFile(pdf, fileName, endDate)
      this.receiptRepository.update(existing.receipt.id, {
        ...columns,
        file_path: stored.relativePath,
        file_size: stored.fileSize
      })
      await deleteDocumentFile(existing.receipt.file_path).catch(() => undefined)
      return existing.receipt.id
    }
    const receiptId = await this.receipts.create(
      {
        companyId: trip.companyId,
        category: trip.category,
        receiptDate: endDate,
        amountCents: trip.totalCents,
        currency: 'EUR',
        supplierCompanyId: null,
        supplierName: trip.travellerName,
        reference: 'Reisekostenabrechnung',
        notes: '',
        fileName,
        inDatev: false
      },
      pdf,
      null
    )
    this.repository.markReport(receiptId, id)
    return receiptId
  }
}
