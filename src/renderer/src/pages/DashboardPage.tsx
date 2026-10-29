import { useNavigate } from '@tanstack/react-router'
import { trpcReact } from '@/lib/trpc'
import { useOpenInvoice } from '@/hooks/useOpenInvoice'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatMoney, invoiceNumberLabel } from '@/lib/invoiceLabels'
import { FollowUpsCard } from '@/components/follow-ups/FollowUpsCard'
import { OverdueInvoicesCard } from '@/components/invoice/OverdueInvoicesCard'

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-800 border-green-200',
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  cancelled: 'bg-red-100 text-red-800 border-red-200'
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Bestätigt',
  pending: 'Ausstehend',
  cancelled: 'Storniert'
}

const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: 'Entwurf',
  issued: 'gestellt',
  paid: 'bezahlt',
  overdue: 'überfällig',
  cancelled: 'storniert'
}

const INVOICE_BADGE_STYLES: Record<string, string> = {
  paid: 'bg-green-100 text-green-800 border-green-200',
  issued: 'bg-blue-100 text-blue-800 border-blue-200',
  cancelled: 'bg-red-100 text-red-800 border-red-200',
  overdue: 'bg-amber-100 text-amber-900 border-amber-200',
  draft: 'bg-slate-100 text-slate-800 border-slate-200'
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  if (!year || !month || !day) return iso
  return `${day}.${month}.${year}`
}

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
      <div>
        <h1 className="text-2xl font-bold mb-2">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Überblick über Ihre Bookings und operativen Daten.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Anstehende Gigs (7 Tage)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats?.upcomingNext7Days.length ?? '–'}</p>
            <p className="text-sm text-muted-foreground mt-1">
              Nicht stornierte Events von heute bis in die nächste Woche
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Ausstehende Bestätigungen</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats?.pendingEventsCount ?? '–'}</p>
            <p className="text-sm text-muted-foreground mt-1">Events mit ausstehendem Status</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Events diesen Monat</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats?.eventsThisMonthCount ?? '–'}</p>
            <p className="text-sm text-muted-foreground mt-1">
              Für den aktuellen Monat geplante Events
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Unbezahlte Rechnungen</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats?.openInvoicesCount ?? '–'}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {stats?.overdueInvoicesCount ?? 0} überfällig · Offener Betrag{' '}
              {formatMoney(stats?.openInvoiceAmount ?? 0, 'EUR')}
            </p>
          </CardContent>
        </Card>
      </div>

      <OverdueInvoicesCard />

      <FollowUpsCard />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Agenda</CardTitle>
            <Button variant="outline" onClick={() => navigate({ to: '/calendar' })}>
              Kalender öffnen
            </Button>
          </CardHeader>
          <CardContent>
            {statsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Anstehende Events werden geladen…</p>
            ) : !stats || stats.upcomingNext7Days.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Keine anstehenden Gigs in den nächsten 7 Tagen.
              </p>
            ) : (
              <div className="space-y-3">
                {stats.upcomingNext7Days.map((event) => (
                  <div
                    key={event.id}
                    className="border rounded-lg p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium">{event.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(event.date)} - {event.bandName}{' '}
                        {event.venueName ? `@ ${event.venueName}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn('capitalize', STATUS_STYLES[event.status] ?? '')}
                      >
                        {STATUS_LABELS[event.status] ?? event.status}
                      </Badge>
                      <Button
                        variant="outline"
                        onClick={() =>
                          navigate({
                            to: '/events/$eventId',
                            params: { eventId: String(event.id) }
                          })
                        }
                      >
                        Event öffnen
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Verzeichnis-Übersicht</CardTitle>
          </CardHeader>
          <CardContent>
            {statsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">
                Verzeichnis-Statistiken werden geladen…
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Bands</span>
                  <span className="font-semibold">{stats?.directory.bands ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Clubs / Festivals</span>
                  <span className="font-semibold">{stats?.directory.venues ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Firmen</span>
                  <span className="font-semibold">{stats?.directory.companies ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Personen</span>
                  <span className="font-semibold">{stats?.directory.persons ?? 0}</span>
                </div>
                <div className="pt-2">
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={() => navigate({ to: '/invoices' })}
                  >
                    Rechnungen verwalten
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Neueste Rechnungen</CardTitle>
          <Button variant="outline" onClick={() => navigate({ to: '/invoices' })}>
            Rechnungen öffnen
          </Button>
        </CardHeader>
        <CardContent>
          {latestInvoicesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Rechnungen werden geladen…</p>
          ) : latestInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Rechnungen vorhanden.</p>
          ) : (
            <div className="space-y-3">
              {latestInvoices.map((invoice) => (
                <div
                  key={invoice.id}
                  className="border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div>
                    <p className="font-medium">
                      {invoiceNumberLabel(invoice.invoiceNumber)} · {invoice.companyName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(invoice.issueDate)}{' '}
                      {invoice.dueDate ? `· fällig am ${formatDate(invoice.dueDate)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant="outline"
                      className={cn('capitalize', INVOICE_BADGE_STYLES[invoice.status] ?? '')}
                    >
                      {INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status}
                    </Badge>
                    <span className="text-sm font-semibold">
                      {formatMoney(invoice.totalAmount, invoice.currency)}
                    </span>
                    <Button variant="outline" onClick={() => openInvoice(invoice)}>
                      Rechnung öffnen
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
