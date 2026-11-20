// The tiles of the event overview's status line, as plain data (tested without a DOM)
import type { InvoiceStatus } from '../../../../main/api/schemas/invoice.schema'
import type { AdvancingStatus } from '../../../../main/api/schemas/advancing.schema'
import type { EventStep } from '../../../../main/api/schemas/event_step.schema'
import { EXTERNAL_DONE_VALUE } from './externalSteps'
import { t } from '../../../../main/i18n/translate'

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
      ? {
          label: t('Gage'),
          value: t('{{amount}} netto', { amount: labels.money(input.fee) }),
          target: 'financials'
        }
      : { label: t('Gage'), value: 'noch offen', tone: 'warn', target: 'financials' }
  )

  tiles.push(
    input.contractReturnedAt
      ? {
          label: t('Vertrag'),
          value: `unterschrieben ${labels.date(input.contractReturnedAt)}`,
          tone: 'ok',
          target: 'financials'
        }
      : external('contract')
        ? { label: t('Vertrag'), value: EXTERNAL_DONE_VALUE, tone: 'ok', target: 'financials' }
        : input.contractSentAt
          ? {
              label: t('Vertrag'),
              value: `verschickt ${labels.date(input.contractSentAt)}`,
              tone: 'warn',
              target: 'financials'
            }
          : {
              label: t('Vertrag'),
              value: t('nicht verschickt'),
              tone: 'muted',
              target: 'financials'
            }
  )

  if (input.invoices) {
    // The newest invoice that still counts (a cancelled one is history)
    const current = [...input.invoices]
      .filter((invoice) => invoice.status !== 'cancelled')
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0]
    tiles.push(
      external('invoice') && current?.status !== 'paid'
        ? { label: t('Rechnung'), value: EXTERNAL_DONE_VALUE, tone: 'ok', target: 'financials' }
        : current
          ? {
              label: t('Rechnung'),
              value: labels.invoice(current.status),
              tone:
                current.status === 'paid'
                  ? 'ok'
                  : current.status === 'overdue'
                    ? 'warn'
                    : undefined,
              target: 'financials'
            }
          : { label: t('Rechnung'), value: t('noch keine'), tone: 'muted', target: 'financials' }
    )
  }

  if (input.advancing) {
    const { status, sold, quota, utilization } = input.advancing
    tiles.push(
      external('advancing') && status !== 'done'
        ? { label: t('Advancing'), value: EXTERNAL_DONE_VALUE, tone: 'ok', target: 'advancing' }
        : {
            label: t('Advancing'),
            value: labels.advancing(status),
            tone: status === 'done' ? 'ok' : status === 'open' ? 'muted' : undefined,
            target: 'advancing'
          }
    )
    tiles.push(
      sold === null && external('tickets')
        ? { label: t('Tickets'), value: EXTERNAL_DONE_VALUE, tone: 'ok', target: 'tickets' }
        : {
            label: t('Tickets'),
            value:
              sold === null
                ? t('keine Meldung')
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
