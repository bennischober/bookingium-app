import { describe, expect, it } from 'vitest'
import {
  EMPTY_WIZARD_FORM,
  isEventBasicsValid,
  isIsoDate,
  openedForm,
  wizardPayload,
  withCreatedItem,
  type WizardFormData
} from '../src/renderer/src/components/event-wizard/wizardState'
import { personFromSearch } from '../src/renderer/src/components/quick-create/personPrefill'

// #61: the event wizard's state rules, out of the component.

const form = (patch: Partial<WizardFormData>): WizardFormData => ({
  ...EMPTY_WIZARD_FORM,
  ...patch
})

describe('openedForm', () => {
  it('keeps the form when there is nothing to prefill', () => {
    const current = form({ name: 'X' })
    expect(openedForm(current)).toBe(current)
  })

  it('sets the open date and lays the prefill over it', () => {
    expect(
      openedForm(form({ name: 'Old' }), '2026-11-20', { name: 'From mail', venueId: 3 })
    ).toEqual(form({ name: 'From mail', date: '2026-11-20', venueId: 3 }))
  })

  it('lets a prefilled date win over the open date', () => {
    expect(openedForm(EMPTY_WIZARD_FORM, '2026-11-20', { date: '2026-12-01' }).date).toBe(
      '2026-12-01'
    )
  })
})

describe('step 1', () => {
  it('needs a name, a date and a band', () => {
    const valid = form({ name: 'Show', date: '2026-11-20', bandId: 1 })
    expect(isEventBasicsValid(valid)).toBe(true)
    expect(isEventBasicsValid({ ...valid, name: '  ' })).toBe(false)
    expect(isEventBasicsValid({ ...valid, date: '' })).toBe(false)
    expect(isEventBasicsValid({ ...valid, bandId: null })).toBe(false)
  })

  it('checks agency bookings only for a complete date', () => {
    expect(isIsoDate('2026-11-20')).toBe(true)
    expect(isIsoDate('2026-11')).toBe(false)
    expect(isIsoDate('')).toBe(false)
  })
})

describe('wizardPayload', () => {
  it('trims, drops an empty deal and reads the ticket prices', () => {
    expect(
      wizardPayload(
        form({
          name: ' Show ',
          date: '2026-11-20',
          bandId: 2,
          deal: '  ',
          ticketPriceVvk: '19.5',
          notes: 'n'
        })
      )
    ).toEqual({
      name: 'Show',
      deal: undefined,
      date: '2026-11-20',
      bandId: 2,
      venueId: null,
      loProPersonId: null,
      loProCompanyId: null,
      status: 'pending',
      ticketPriceVvk: 19.5,
      ticketPriceAk: null,
      notes: 'n'
    })
  })
})

describe('withCreatedItem', () => {
  const items = [{ id: 1, label: 'A' }]

  it('adds a record created just now until the list has it', () => {
    expect(withCreatedItem(items, 7, 'New')).toEqual([...items, { id: 7, label: 'New' }])
    expect(withCreatedItem([...items, { id: 7, label: 'New' }], 7, 'New')).toHaveLength(2)
  })

  it('adds nothing without a created record or a selection', () => {
    expect(withCreatedItem(items, 7, null)).toBe(items)
    expect(withCreatedItem(items, null, 'New')).toBe(items)
  })
})

describe('personFromSearch', () => {
  it('reads the first word as first name and the rest as last name', () => {
    expect(personFromSearch('  Anna  von Berg ')).toEqual({
      firstName: 'Anna',
      lastName: 'von Berg',
      email: ''
    })
    expect(personFromSearch('')).toEqual({ firstName: '', lastName: '', email: '' })
  })
})
