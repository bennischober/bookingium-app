import { useNavigate } from '@tanstack/react-router'
import { trpcReact } from '@/lib/trpc'
import { formatShortDate } from '@/lib/utils'
import { formatMoney, INVOICE_STATUS_LABELS } from '@/lib/invoiceLabels'
import { StatusLine, type StatusItem } from '@/components/detail/CompactParts'
import { ADVANCING_STATUS_LABELS } from '../../../../main/api/schemas/advancing.schema'
import type { DealMemoDetailDto } from '../../../../main/api/schemas/deal_memo.schema'
import { eventStatusItems } from './eventStatus'

/**
 * The show's state at a glance on top of the overview: fee, contract, invoice, advancing and
 * tickets. Each tile opens the area where it is changed.
 */
export function EventStatusLine({ event }: { event: DealMemoDetailDto }) {
  const navigate = useNavigate()
  const invoices = trpcReact.invoice.getByDealMemoId.useQuery(event.id)
  const advancing = trpcReact.advancing.get.useQuery({ eventId: event.id })
  const open = (tab: string) => navigate({ to: '.', search: { tab } as never, replace: true })

  const items: StatusItem[] = eventStatusItems({
    fee: event.guaranteeAmount,
    contractSentAt: event.contractSentAt,
    contractReturnedAt: event.contractReturnedAt,
    invoices: invoices.data,
    advancing: advancing.data,
    labels: {
      money: (value) => formatMoney(value, 'EUR'),
      date: formatShortDate,
      invoice: (status) => INVOICE_STATUS_LABELS[status],
      advancing: (status) => ADVANCING_STATUS_LABELS[status]
    }
  }).map(({ target, ...item }) => ({ ...item, onClick: () => open(target) }))

  return <StatusLine items={items} />
}
