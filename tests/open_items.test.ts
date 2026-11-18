// #201: "Offene Punkte" - what waits for the user, computed from events, deposits and invoices.
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { OpenItemsService } from '../src/main/services/OpenItemsService'
import { DealMemoService } from '../src/main/services/DealMemoService'
import { openItemTab, openItemText } from '../src/renderer/src/components/open-items/openItemText'
import { formatMoney } from '../src/main/invoice/money'
import { setupTestDb } from './helpers/setup'

setupTestDb()

const TODAY = '2026-11-18'

let counter = 0
function event(values: Partial<typeof schema.deal_memo.$inferInsert> = {}): number {
  counter += 1
  const company = db
    .insert(schema.company)
    .values({ name: `Offen Firma ${counter}` })
    .returning()
    .get()
  const band = db
    .insert(schema.band)
    .values({ name: `Offen Band ${counter}`, company_id: company.id })
    .returning()
    .get()
  return db
    .insert(schema.deal_memo)
    .values({ name: `Offen ${counter}`, band_id: band.id, date: '2027-03-01', ...values })
    .returning()
    .get().id
}

function invoice(dealMemoId: number, status: string): void {
  const company = db.select().from(schema.company).limit(1).get()!
  db.insert(schema.invoice)
    .values({ company_id: company.id, deal_memo_id: dealMemoId, status })
    .run()
}

const openItems = (eventId: number) => container.resolve(OpenItemsService).list(eventId, TODAY)
const kinds = async (eventId: number) => (await openItems(eventId)).map((item) => item.kind)

describe('open items', () => {
  it('lists a contract sent but not back, until it is back', async () => {
    const id = event({ contract_sent_at: '2026-11-01' })
    const [item] = await openItems(id)
    expect(item).toMatchObject({ kind: 'contract', date: '2026-11-01', bandName: 'Offen Band 1' })

    await container.resolve(DealMemoService).updateDealMemo({ id, contractReturnedAt: TODAY })
    expect(await kinds(id)).toEqual([])
  })

  it('lists an unpaid deposit once due; one without a due date once the contract is back', async () => {
    const id = event({ contract_sent_at: '2026-11-01' })
    const service = container.resolve(DealMemoService)
    await service.updateDealMemo({
      id,
      deposits: [
        { amount: 500, dueDate: null },
        { amount: 1000, dueDate: '2026-11-10' },
        { amount: 1500, dueDate: '2026-12-01' }
      ]
    })
    let items = (await openItems(id)).filter((item) => item.kind === 'deposit')
    expect(items.map((item) => [item.depositPosition, item.depositAmount])).toEqual([[2, 1000]])

    await service.updateDealMemo({ id, contractReturnedAt: '2026-11-15' })
    items = (await openItems(id)).filter((item) => item.kind === 'deposit')
    expect(items.map((item) => [item.depositPosition, item.date])).toEqual([
      [2, '2026-11-10'],
      [1, '2026-11-15']
    ])

    await service.updateDealMemo({
      id,
      deposits: [
        { amount: 500, dueDate: null, paidAt: '2026-11-16' },
        { amount: 1000, dueDate: '2026-11-10', paidAt: '2026-11-12' },
        { amount: 1500, dueDate: '2026-12-01' }
      ]
    })
    expect(await kinds(id)).toEqual([])
    const stored = await service.getDealMemoById(id)
    expect(stored?.deposits.map((deposit) => deposit.paid_at)).toEqual([
      '2026-11-16',
      '2026-11-12',
      null
    ])
  })

  it('lists a confirmed show that is over and not invoiced, noting a draft', async () => {
    const id = event({ status: 'confirmed', date: '2026-11-10' })
    expect(await kinds(id)).toEqual(['invoice'])

    invoice(id, 'draft')
    const [item] = await openItems(id)
    expect(item).toMatchObject({ kind: 'invoice', hasDraftInvoice: true })

    invoice(id, 'issued')
    expect(await kinds(id)).toEqual([])
  })

  it('lists a confirmed show within the hotel horizon without a hotel', async () => {
    const soon = event({ status: 'confirmed', date: '2026-12-10' })
    const far = event({ status: 'confirmed', date: '2027-01-30' })
    const offer = event({ status: 'pending', date: '2026-12-10' })
    expect(await kinds(soon)).toEqual(['hotel'])
    expect(await kinds(far)).toEqual([])
    expect(await kinds(offer)).toEqual([])

    const hotel = db.insert(schema.hotel).values({ name: 'Offen Hotel' }).returning().get()
    await container.resolve(DealMemoService).updateDealMemo({ id: soon, hotelId: hotel.id })
    expect(await kinds(soon)).toEqual([])
  })

  it('drops an event once its invoice is paid, cancelled or archived', async () => {
    const paid = event({ contract_sent_at: '2026-11-01' })
    invoice(paid, 'paid')
    const cancelled = event({ contract_sent_at: '2026-11-01', status: 'cancelled' })
    const archived = event({ contract_sent_at: '2026-11-01', archived_at: '2026-11-02 10:00:00' })
    expect(await kinds(paid)).toEqual([])
    expect(await kinds(cancelled)).toEqual([])
    expect(await kinds(archived)).toEqual([])
  })

  it('orders all open points oldest first', async () => {
    const late = event({ contract_sent_at: '2026-11-05' })
    const early = event({ contract_sent_at: '2026-10-05' })
    const all = await container.resolve(OpenItemsService).list(undefined, TODAY)
    const ids = all.map((item) => item.eventId)
    expect(ids.indexOf(early)).toBeLessThan(ids.indexOf(late))
    const dates = all.map((item) => item.date)
    expect(dates).toEqual([...dates].sort())
  })
})

describe('open item wording', () => {
  const base = {
    eventId: 1,
    eventName: 'Show',
    eventDate: '2026-11-10',
    bandName: null,
    depositPosition: null,
    depositAmount: null,
    hasDraftInvoice: false
  }

  it('says what is open and where it is resolved', () => {
    const contract = { ...base, kind: 'contract' as const, date: '2026-11-01' }
    expect(openItemText(contract, TODAY)).toBe(
      'Vertrag am 01.11.2026 verschickt, noch nicht unterschrieben zurück'
    )
    expect(openItemTab(contract)).toBe('financials')

    const deposit = { ...base, kind: 'deposit' as const, depositPosition: 2, depositAmount: 1000 }
    expect(openItemText({ ...deposit, date: '2026-11-10' }, TODAY)).toBe(
      `2. Vorkasse über ${formatMoney(1000, 'EUR')} seit 10.11.2026 fällig, noch nicht bezahlt`
    )
    expect(openItemText({ ...deposit, date: TODAY }, TODAY)).toBe(
      `2. Vorkasse über ${formatMoney(1000, 'EUR')} heute fällig`
    )

    const invoice = { ...base, kind: 'invoice' as const, date: '2026-11-10' }
    expect(openItemText(invoice, TODAY)).toBe(
      'Show am 10.11.2026 vorbei, noch keine Rechnung gestellt'
    )
    expect(openItemText({ ...invoice, hasDraftInvoice: true }, TODAY)).toBe(
      'Show am 10.11.2026 vorbei, Rechnung liegt noch als Entwurf vor'
    )

    const hotel = { ...base, kind: 'hotel' as const, date: '2026-12-10' }
    expect(openItemText(hotel, TODAY)).toBe('Show am 10.12.2026, noch kein Hotel eingetragen')
    expect(openItemTab(hotel)).toBe('itinerary')
  })
})
