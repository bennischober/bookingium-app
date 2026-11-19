import { useNavigate } from '@tanstack/react-router'
import { trpcReact } from '@/lib/trpc'
import { useOpenInvoice } from '@/hooks/useOpenInvoice'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  formatMoney,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_STYLES,
  invoiceNumberLabel
} from '@/lib/invoiceLabels'
import { STATUS_LABELS, STATUS_STYLES } from '@/components/event-hub/constants'
import { Tip } from '@/components/Tip'
import { StatusLine } from '@/components/detail/CompactParts'
import { FollowUpsCard } from '@/components/follow-ups/FollowUpsCard'
import { OverdueInvoicesCard } from '@/components/invoice/OverdueInvoicesCard'
import { DatevPendingCard } from '@/components/invoice/DatevPendingCard'
import { ReceiptPendingCard } from '@/components/receipts/ReceiptPendingCard'
import { OpenItemsCard } from '@/components/open-items/OpenItemsCard'

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  if (!year || !month || !day) return iso
  return `${day}.${month}.${year}`
}

/**
 * Dashboard: the numbers in one line, then what is to do (open items, follow-ups, unpaid and
 * unfiled invoices), then the next days and the newest invoices side by side
 */
export default function DashboardPage() {
  const navigate = useNavigate()
  const openInvoice = useOpenInvoice()

  // One SQL-computed stats call (single IPC round-trip, tiny payload)
  const statsQuery = trpcReact.dashboard.getStats.useQuery()
  const stats = statsQuery.data
  const latestInvoicesQuery = trpcReact.invoice.getAllPaginated.useQuery({
    page: 1,
    pageSize: 5,
    search: undefined
  })
  const latestInvoices = latestInvoicesQuery.data?.items ?? []

  return (
    <div className="flex flex-col w-full h-full p-6 gap-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <Tip id="dashboard" />

      <StatusLine
        items={[
          {
            label: 'Events nächste 7 Tage',
            value: String(stats?.upcomingNext7Days.length ?? '–'),
            onClick: () => navigate({ to: '/calendar' })
          },
          {
            label: 'Events diesen Monat',
            value: String(stats?.eventsThisMonthCount ?? '–'),
            onClick: () => navigate({ to: '/calendar' })
          },
          {
            label: 'Unbestätigt',
            value: String(stats?.pendingEventsCount ?? '–'),
            tone: stats?.pendingEventsCount ? 'warn' : undefined,
            onClick: () => navigate({ to: '/events' })
          },
          {
            label: 'Offene Rechnungen',
            value: `${stats?.openInvoicesCount ?? '–'} · ${formatMoney(stats?.openInvoiceAmount ?? 0, 'EUR')}`,
            onClick: () => navigate({ to: '/invoices' })
          },
          {
            label: 'Davon überfällig',
            value: String(stats?.overdueInvoicesCount ?? '–'),
            tone: stats?.overdueInvoicesCount ? 'warn' : 'ok',
            onClick: () => navigate({ to: '/invoices' })
          }
        ]}
      />

      {/* What is to do: open items, follow-ups, unpaid and not yet filed invoices */}
      <OpenItemsCard />
      <FollowUpsCard />
      <OverdueInvoicesCard />
      <DatevPendingCard />
      <ReceiptPendingCard />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Nächste 7 Tage</CardTitle>
            <Button variant="outline" size="sm" onClick={() => navigate({ to: '/calendar' })}>
              Kalender öffnen
            </Button>
          </CardHeader>
          <CardContent>
            {statsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Anstehende Events werden geladen…</p>
            ) : !stats || stats.upcomingNext7Days.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Keine anstehenden Events in den nächsten 7 Tagen.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {stats.upcomingNext7Days.map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/60"
                      onClick={() =>
                        navigate({ to: '/events/$eventId', params: { eventId: String(event.id) } })
                      }
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{event.name}</span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {formatDate(event.date)} · {event.bandName}
                          {event.venueName ? ` @ ${event.venueName}` : ''}
                        </span>
                      </span>
                      <Badge variant="outline" className={cn(STATUS_STYLES[event.status] ?? '')}>
                        {STATUS_LABELS[event.status] ?? event.status}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Neueste Rechnungen</CardTitle>
            <Button variant="outline" size="sm" onClick={() => navigate({ to: '/invoices' })}>
              Rechnungen öffnen
            </Button>
          </CardHeader>
          <CardContent>
            {latestInvoicesQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Rechnungen werden geladen…</p>
            ) : latestInvoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">Noch keine Rechnungen vorhanden.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {latestInvoices.map((invoice) => (
                  <li key={invoice.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/60"
                      onClick={() => openInvoice(invoice)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {invoiceNumberLabel(invoice.invoiceNumber)} · {invoice.recipientName}
                        </span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {formatDate(invoice.issueDate)}
                          {invoice.dueDate ? ` · fällig am ${formatDate(invoice.dueDate)}` : ''}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="text-sm font-semibold tabular-nums">
                          {formatMoney(invoice.totalAmount, invoice.currency)}
                        </span>
                        <Badge variant="outline" className={INVOICE_STATUS_STYLES[invoice.status]}>
                          {INVOICE_STATUS_LABELS[invoice.status]}
                        </Badge>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
