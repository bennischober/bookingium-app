// The tiles of the event overview's status line, as plain data (tested without a DOM)
import type { InvoiceStatus } from '../../../../main/api/schemas/invoice.schema'
import type { AdvancingStatus } from '../../../../main/api/schemas/advancing.schema'
import type { EventStep } from '../../../../main/api/schemas/event_step.schema'
import { EXTERNAL_DONE_VALUE } from './externalSteps'

export type EventStatusTile = {
  label: string
  value: string
  tone?: 'ok' | 'warn' | 'muted'
  /** The `?tab=` the tile opens; former tab names scroll to their section */
  target: string
}

export function eventStatusItems(input: {
  /** Net fee in euros */
  fee: number | null
  contractSentAt: string | null
  contractReturnedAt: string | null
  invoices: Array<{ status: InvoiceStatus; issueDate: string }> | undefined
  advancing:
    | {
        status: AdvancingStatus
        sold: number | null
        quota: number | null
        utilization: number | null
      }
    | undefined
  /** Steps ticked as done outside the program ("extern erledigt") */
  externalDone?: ReadonlySet<EventStep>
  labels: {
    money: (value: number) => string
    date: (iso: string) => string
    invoice: (status: InvoiceStatus) => string
    advancing: (status: AdvancingStatus) => string
  }
}): EventStatusTile[] {
  const { labels } = input
  const tiles: EventStatusTile[] = []
  const external = (step: EventStep) => input.externalDone?.has(step) ?? false

  tiles.push(
    input.fee !== null && input.fee > 0
      ? { label: 'Gage', value: `${labels.money(input.fee)} netto`, target: 'financials' }
      : { label: 'Gage', value: 'noch offen', tone: 'warn', target: 'financials' }
  )

  tiles.push(
    input.contractReturnedAt
      ? {
          label: 'Vertrag',
          value: `unterschrieben ${labels.date(input.contractReturnedAt)}`,
          tone: 'ok',
          target: 'financials'
        }
      : external('contract')
        ? { label: 'Vertrag', value: EXTERNAL_DONE_VALUE, tone: 'ok', target: 'financials' }
        : input.contractSentAt
          ? {
              label: 'Vertrag',
              value: `verschickt ${labels.date(input.contractSentAt)}`,
              tone: 'warn',
              target: 'financials'
            }
          : { label: 'Vertrag', value: 'nicht verschickt', tone: 'muted', target: 'financials' }
  )

  if (input.invoices) {
    // The newest invoice that still counts (a cancelled one is history)
    const current = [...input.invoices]
      .filter((invoice) => invoice.status !== 'cancelled')
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0]
    tiles.push(
      external('invoice') && current?.status !== 'paid'
        ? { label: 'Rechnung', value: EXTERNAL_DONE_VALUE, tone: 'ok', target: 'financials' }
        : current
          ? {
              label: 'Rechnung',
              value: labels.invoice(current.status),
              tone:
                current.status === 'paid'
                  ? 'ok'
                  : current.status === 'overdue'
                    ? 'warn'
                    : undefined,
              target: 'financials'
            }
          : { label: 'Rechnung', value: 'noch keine', tone: 'muted', target: 'financials' }
    )
  }

  if (input.advancing) {
    const { status, sold, quota, utilization } = input.advancing
    tiles.push(
      external('advancing') && status !== 'done'
        ? { label: 'Advancing', value: EXTERNAL_DONE_VALUE, tone: 'ok', target: 'advancing' }
        : {
            label: 'Advancing',
            value: labels.advancing(status),
            tone: status === 'done' ? 'ok' : status === 'open' ? 'muted' : undefined,
            target: 'advancing'
          }
    )
    tiles.push(
      sold === null && external('tickets')
        ? { label: 'Tickets', value: EXTERNAL_DONE_VALUE, tone: 'ok', target: 'tickets' }
        : {
            label: 'Tickets',
            value:
              sold === null
                ? 'keine Meldung'
                : quota
                  ? `${sold} / ${quota}${utilization === null ? '' : ` (${utilization} %)`}`
                  : `${sold} verkauft`,
            tone: sold === null ? 'muted' : undefined,
            target: 'tickets'
          }
    )
  }

  return tiles
}
