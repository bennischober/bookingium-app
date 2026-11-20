// The status line on top of an event's overview
import { describe, expect, it } from 'vitest'
import { eventStatusItems } from '../src/renderer/src/components/event-hub/eventStatus'
import { stepFileCount } from '../src/renderer/src/components/event-hub/externalSteps'

const labels = {
  money: (value: number) => `${value} €`,
  date: (iso: string) => iso,
  invoice: (status: string) => status,
  advancing: (status: string) => status
}

const base = {
  fee: null,
  contractSentAt: null,
  contractReturnedAt: null,
  invoices: undefined,
  advancing: undefined,
  labels
}

describe('event status line', () => {
  it('asks for the fee and the contract when nothing is set', () => {
    const tiles = eventStatusItems(base)
    expect(tiles.map((tile) => [tile.label, tile.value, tile.tone])).toEqual([
      ['Gage', 'noch offen', 'warn'],
      ['Vertrag', 'nicht verschickt', 'muted']
    ])
  })

  it('shows the signed contract, the newest invoice that counts and the tickets', () => {
    const tiles = eventStatusItems({
      ...base,
      fee: 2500,
      contractSentAt: '2026-10-01',
      contractReturnedAt: '2026-10-08',
      invoices: [
        { status: 'cancelled', issueDate: '2026-11-02' },
        { status: 'issued', issueDate: '2026-10-20' }
      ],
      advancing: { status: 'in_progress', sold: 120, quota: 400, utilization: 30 }
    })
    expect(tiles.map((tile) => tile.value)).toEqual([
      '2500 € netto',
      'unterschrieben 2026-10-08',
      'issued',
      'in_progress',
      '120 / 400 (30 %)'
    ])
    // Former tab names: the tiles lead to their section
    expect(tiles.map((tile) => tile.target)).toEqual([
      'financials',
      'financials',
      'financials',
      'advancing',
      'tickets'
    ])
  })

  it('says when there is no invoice or ticket report yet', () => {
    const tiles = eventStatusItems({
      ...base,
      invoices: [],
      advancing: { status: 'open', sold: null, quota: null, utilization: null }
    })
    expect(tiles.slice(2).map((tile) => tile.value)).toEqual([
      'noch keine',
      'open',
      'keine Meldung'
    ])
  })

  it('says "extern erledigt" for steps ticked as done outside the program', () => {
    const tiles = eventStatusItems({
      ...base,
      contractSentAt: '2026-10-01',
      invoices: [{ status: 'issued', issueDate: '2026-10-20' }],
      advancing: { status: 'contacted', sold: null, quota: 400, utilization: null },
      externalDone: new Set(['contract', 'invoice', 'advancing', 'tickets'] as const)
    })
    expect(tiles.slice(1).map((tile) => [tile.label, tile.value, tile.tone])).toEqual([
      ['Vertrag', 'extern erledigt', 'ok'],
      ['Rechnung', 'extern erledigt', 'ok'],
      ['Advancing', 'extern erledigt', 'ok'],
      ['Tickets', 'extern erledigt', 'ok']
    ])
  })

  it('keeps what the program knows over a tick', () => {
    const tiles = eventStatusItems({
      ...base,
      contractReturnedAt: '2026-10-08',
      invoices: [{ status: 'paid', issueDate: '2026-10-20' }],
      advancing: { status: 'done', sold: 120, quota: null, utilization: null },
      externalDone: new Set(['contract', 'invoice', 'advancing', 'tickets'] as const)
    })
    expect(tiles.slice(1).map((tile) => tile.value)).toEqual([
      'unterschrieben 2026-10-08',
      'paid',
      'done',
      '120 verkauft'
    ])
  })
})

describe('files of a step done outside the program', () => {
  it('counts the event files of the step by their type', () => {
    const documents = [
      { documentType: 'contract' },
      { documentType: 'invoice' },
      { documentType: 'contract' },
      { documentType: 'deposit' },
      { documentType: 'rider' }
    ]
    expect(stepFileCount('contract', documents)).toBe(2)
    expect(stepFileCount('invoice', documents)).toBe(1)
    expect(stepFileCount('deposit', documents)).toBe(1)
    // no file type for these steps
    expect(stepFileCount('hotel', documents)).toBe(0)
    expect(stepFileCount('contract', [])).toBe(0)
  })
})
