// #199: "Event duplizieren" - what a new date takes from an existing event.
import { describe, it, expect } from 'vitest'
import { duplicateOf } from '../src/renderer/src/components/event-wizard/duplicateEvent'
import {
  EMPTY_WIZARD_FORM,
  isEventBasicsValid,
  openedForm,
  wizardPayload
} from '../src/renderer/src/components/event-wizard/wizardState'
import { CreateDealMemoInput, type DealMemoDto } from '../src/main/api/schemas/deal_memo.schema'

const source = {
  id: 7,
  name: 'Pretty Wild - Herbsttour',
  date: '2026-10-03',
  status: 'confirmed',
  bandId: 3,
  venueId: 11,
  hotelId: 4,
  deal: '70/30 nach Kosten',
  tour: 'Herbst 2026',
  loProPersonId: 21,
  loProCompanyId: 22,
  invoiceCompanyId: 5,
  representingCompanyId: 6,
  ticketPriceVvk: 18.5,
  ticketPriceAk: null,
  guaranteeAmount: 1500,
  guaranteeVatRate: 19,
  contractNotes: 'Catering für 5',
  notes: 'Merch selbst',
  deposits: [{ amount: 500, dueDate: null }]
} as unknown as DealMemoDto

describe('#199: duplicating an event', () => {
  it('takes band, deal, LoPro, prices, notes, tour and invoicing', () => {
    const { prefill, carry } = duplicateOf(source)
    expect(prefill).toMatchObject({
      name: 'Pretty Wild - Herbsttour',
      bandId: 3,
      loProPersonId: 21,
      loProCompanyId: 22,
      deal: '70/30 nach Kosten',
      ticketPriceVvk: '18.5',
      ticketPriceAk: '',
      notes: 'Merch selbst'
    })
    expect(carry).toEqual({
      invoiceCompanyId: 5,
      representingCompanyId: 6,
      guaranteeAmount: 1500,
      guaranteeVatRate: 19,
      contractNotes: 'Catering für 5',
      tour: 'Herbst 2026'
    })
  })

  it('asks for date and club / festival again and starts as Ausstehend', () => {
    const { prefill } = duplicateOf(source)
    expect(prefill).not.toHaveProperty('date')
    expect(prefill).not.toHaveProperty('venueId')
    expect(prefill.status).toBe('pending')
    const form = openedForm(EMPTY_WIZARD_FORM, undefined, prefill)
    expect(form).toMatchObject({ date: '', venueId: null })
    expect(isEventBasicsValid(form)).toBe(false) // no date yet
    expect(isEventBasicsValid({ ...form, date: '2026-10-10' })).toBe(true)
  })

  it('copies nothing of the source event`s history', () => {
    const { prefill, carry } = duplicateOf(source)
    const payload = wizardPayload(
      openedForm(EMPTY_WIZARD_FORM, undefined, { ...prefill, date: '2026-10-10' }),
      carry
    )
    for (const key of ['hotelId', 'deposits', 'id']) expect(payload).not.toHaveProperty(key)
    expect(payload.venueId).toBeNull()
    expect(payload.status).toBe('pending')
  })

  it('creates a valid event input with the carried fields', () => {
    const { prefill, carry } = duplicateOf(source)
    const input = CreateDealMemoInput.parse(
      wizardPayload(openedForm(EMPTY_WIZARD_FORM, '2026-10-10', prefill), carry)
    )
    expect(input).toMatchObject({
      name: 'Pretty Wild - Herbsttour',
      date: '2026-10-10',
      bandId: 3,
      invoiceCompanyId: 5,
      representingCompanyId: 6,
      guaranteeAmount: 1500,
      tour: 'Herbst 2026',
      contractNotes: 'Catering für 5',
      ticketPriceVvk: 18.5
    })
  })
})
