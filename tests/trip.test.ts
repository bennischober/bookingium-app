// #225 step 2: business trips - allowances, receipts of the trip, and the report PDF that is
// stored as a receipt and goes to DATEV in place of the trip's single receipts.
import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { container } from 'tsyringe'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PDFDocument } from 'pdf-lib'
import { TripService } from '../src/main/services/TripService'
import { ReceiptService } from '../src/main/services/ReceiptService'
import { CompanyService } from '../src/main/services/CompanyService'
import { DatevService } from '../src/main/services/DatevService'
import { setStorageBasePath } from '../src/main/utils/fileStorage'
import type { ReceiptFields } from '../src/main/api/schemas/receipt.schema'
import type { TripFields } from '../src/main/api/schemas/trip.schema'
import { setupTestDb } from './helpers/setup'

setupTestDb()

let storage: string
beforeAll(() => {
  storage = join(mkdtempSync(join(tmpdir(), 'bookingum-trips-')), 'storage')
  setStorageBasePath(storage)
})
afterAll(() => {
  setStorageBasePath(null)
  rmSync(join(storage, '..'), { recursive: true, force: true })
})

async function twoPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage()
  doc.addPage()
  return doc.save()
}

const receipt = (overrides: Partial<ReceiptFields>): ReceiptFields => ({
  companyId: null,
  category: 'credit_card',
  receiptDate: '2026-11-04',
  amountCents: 12000,
  currency: 'EUR',
  supplierCompanyId: null,
  supplierName: 'Hotel Beispiel',
  reference: '',
  notes: '',
  fileName: 'Hotel',
  ...overrides
})

const tripFields = (overrides: Partial<TripFields> = {}): TripFields => ({
  companyId: null,
  personId: null,
  travellerName: 'Erika Beispiel',
  purpose: 'Tourbegleitung',
  destination: 'Musterstadt',
  countryCode: 'DE',
  startAt: '2026-11-03T08:00',
  endAt: '2026-11-05T18:00',
  overnight: true,
  ratePartialCents: null,
  rateFullCents: null,
  kilometres: 250,
  vehicle: 'car',
  meals: { '2026-11-04': { breakfast: true, lunch: false, dinner: false } },
  category: 'other',
  notes: '',
  ...overrides
})

describe('trips', () => {
  const trips = container.resolve(TripService)
  const receipts = container.resolve(ReceiptService)
  const datev = container.resolve(DatevService)
  let ownId: number

  beforeAll(async () => {
    ownId = (
      await container.resolve(CompanyService).createCompany({
        name: 'Agentur Beispiel',
        isDefaultForInvoicing: true
      })
    ).id
  })

  it('computes allowances and mileage and refuses impossible times', () => {
    const trip = trips.create(tripFields())
    // 14 + (28 - 5,60) + 14 = 50,40 €; 250 km × 0,30 € = 75 €
    expect(trip).toMatchObject({
      companyId: ownId,
      allowancesCents: 5040,
      mileageCents: 7500,
      receiptsCents: 0,
      totalCents: 12540,
      report: null
    })
    expect(() => trips.create(tripFields({ endAt: '2026-11-02T10:00' }))).toThrow(/nach dem Beginn/)
    // Meals outside the trip are dropped
    const updated = trips.update({
      ...tripFields({ meals: { '2026-12-24': { breakfast: true, lunch: true, dinner: true } } }),
      id: trip.id
    })
    expect(updated.meals).toEqual({})
  })

  it('builds the report with the receipts behind it and keeps one report per trip', async () => {
    const trip = trips.create(tripFields({ kilometres: 0 }))
    const hotel = await receipts.create(receipt({}), await twoPagePdf(), null)
    const train = await receipts.create(
      receipt({ supplierName: 'Bahn', amountCents: 8990, fileName: 'Bahn' }),
      await twoPagePdf(),
      null
    )
    trips.assignReceipt(hotel, trip.id)
    trips.assignReceipt(train, trip.id)
    expect(trips.get(trip.id)).toMatchObject({ receiptsCents: 20990, totalCents: 5040 + 20990 })
    expect(trips.unassignedReceipts().map((r) => r.id)).not.toContain(hotel)

    const reportId = await trips.buildReport(trip.id)
    const report = receipts.getById(reportId)!.receipt
    expect(report).toMatchObject({
      trip_id: trip.id,
      trip_report: true,
      amount_cents: 26030,
      category: 'other',
      file_name: 'Reisekosten 2026-11-03 Erika Beispiel Musterstadt.pdf'
    })
    const pdf = await PDFDocument.load(readFileSync(join(storage, report.file_path)))
    // One summary page and both receipts' two pages
    expect(pdf.getPageCount()).toBe(5)

    // Rebuilding replaces the file of the same receipt
    trips.assignReceipt(train, null)
    const again = await trips.buildReport(trip.id)
    expect(again).toBe(reportId)
    const replaced = receipts.getById(reportId)!.receipt
    expect(replaced.amount_cents).toBe(5040 + 12000)
    expect(existsSync(join(storage, report.file_path))).toBe(
      replaced.file_path === report.file_path
    )
    expect(
      (await PDFDocument.load(readFileSync(join(storage, replaced.file_path)))).getPageCount()
    ).toBe(3)
    expect(trips.get(trip.id)!.report).toMatchObject({ receiptId: reportId, datev: 'none' })
  })

  it('puts the report, not the trip receipts, on the Dashboard for DATEV', async () => {
    await datev.setUploadEmail({
      companyId: ownId,
      category: 'other',
      datevUploadEmail: 'sonst@duo.example.test'
    })
    await datev.setUploadEmail({
      companyId: ownId,
      category: 'credit_card',
      datevUploadEmail: 'kk@duo.example.test'
    })
    const trip = trips.create(
      tripFields({ startAt: '2026-12-01T08:00', endAt: '2026-12-01T20:00' })
    )
    const single = await receipts.create(receipt({ fileName: 'Einzeln' }), await twoPagePdf(), null)
    const ofTrip = await receipts.create(receipt({ fileName: 'Reise' }), await twoPagePdf(), null)
    trips.assignReceipt(ofTrip, trip.id)
    const reportId = await trips.buildReport(trip.id)
    const pending = receipts.listNotHandedOver().map((row) => row.receipt.id)
    expect(pending).toContain(single)
    expect(pending).toContain(reportId)
    expect(pending).not.toContain(ofTrip)
  })

  it('keeps receipts and the report when a trip is deleted', async () => {
    const trip = trips.create(
      tripFields({ startAt: '2026-12-10T08:00', endAt: '2026-12-10T20:00' })
    )
    const ofTrip = await receipts.create(receipt({ fileName: 'Bleibt' }), await twoPagePdf(), null)
    trips.assignReceipt(ofTrip, trip.id)
    const reportId = await trips.buildReport(trip.id)
    trips.delete(trip.id)
    expect(receipts.getById(ofTrip)!.receipt.trip_id).toBeNull()
    expect(receipts.getById(reportId)!.receipt).toMatchObject({ trip_id: null, trip_report: false })
  })
})
