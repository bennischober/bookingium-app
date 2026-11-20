import { useState } from 'react'
import { CheckCircle2, Trash2 } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import { formatShortDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ListPageHeader } from '@/components/ListPageHeader'
import { TripDialog } from '@/components/trips/TripDialog'
import { amountText } from '@/components/receipts/receiptForm'
import type { TripDto } from '../../../main/api/schemas/trip.schema'
import { t } from '../../../main/i18n/translate'

/** #225 step 2: business trips (Reisekostenabrechnung) */
export default function TripPage() {
  const utils = trpcReact.useUtils()
  const trips = trpcReact.trip.list.useQuery()
  // undefined: closed; null: a new trip
  const [editing, setEditing] = useState<number | null | undefined>(undefined)
  const remove = trpcReact.trip.delete.useMutation({
    onSuccess: () => {
      void utils.trip.invalidate()
      void utils.receipt.invalidate()
      toast.success(t('Reise gelöscht'), { description: t('Die Belege bleiben unter Belege.') })
    },
    onError: (error) =>
      toast.error(t('Reise konnte nicht gelöscht werden'), { description: error.message })
  })

  const confirmRemove = async (trip: TripDto) => {
    const confirmed = await confirmAction({
      title: t('Reise „{{value}}“ löschen?', {
        value: trip.purpose || trip.destination || trip.travellerName
      }),
      description: t('Die Belege und eine erstellte Abrechnung bleiben unter Belege erhalten.'),
      confirmLabel: t('Löschen'),
      destructive: true
    })
    if (confirmed) remove.mutate({ id: trip.id })
  }

  const list = trips.data ?? []
  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <ListPageHeader
        title={t('Reisekosten')}
        description={t(
          'Dienstreisen mit Verpflegungspauschalen, Kilometern und Belegen; die Abrechnung geht als ein PDF an DATEV.'
        )}
      >
        <Button onClick={() => setEditing(null)}>{t('+ Neue Reise')}</Button>
      </ListPageHeader>

      {trips.isLoading && <p className="text-sm text-muted-foreground">{t('Wird geladen…')}</p>}
      {!trips.isLoading && list.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('Noch keine Reise erfasst.')}</p>
      )}
      {list.length > 0 && (
        <div className="min-h-0 overflow-auto rounded-md border">
          <table className="w-full text-sm" aria-label={t('Reisen')}>
            <thead className="sticky top-0 bg-muted text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{t('Zeitraum')}</th>
                <th className="px-3 py-2 font-medium">{t('Person')}</th>
                <th className="px-3 py-2 font-medium">{t('Anlass / Ziel')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('Belege')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('Erstattung')}</th>
                <th className="px-3 py-2 font-medium">DATEV</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {list.map((trip) => (
                <tr
                  key={trip.id}
                  className="cursor-pointer border-t hover:bg-muted/50"
                  onClick={() => setEditing(trip.id)}
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    {formatShortDate(trip.startAt.slice(0, 10))}
                    {trip.endAt.slice(0, 10) !== trip.startAt.slice(0, 10) &&
                      ` – ${formatShortDate(trip.endAt.slice(0, 10))}`}
                  </td>
                  <td className="px-3 py-2">{trip.travellerName}</td>
                  <td className="px-3 py-2">
                    {[trip.purpose, trip.destination].filter(Boolean).join(' · ') || '–'}
                  </td>
                  <td className="px-3 py-2 text-right">{trip.receipts.length}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {amountText(trip.totalCents)} €
                  </td>
                  <td className="px-3 py-2">
                    {!trip.report ? (
                      <span className="text-muted-foreground">{t('keine Abrechnung')}</span>
                    ) : trip.report.datev === 'sent' ? (
                      <Badge variant="secondary" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" /> {t('übergeben')}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">
                        {trip.report.datev === 'pending' ? t('wird bestätigt') : 'offen'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('Reise löschen')}
                      onClick={(event) => {
                        event.stopPropagation()
                        void confirmRemove(trip)
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing !== undefined && (
        <TripDialog
          key={editing ?? 'new'}
          open
          onOpenChange={(next) => {
            if (!next) setEditing(undefined)
          }}
          tripId={editing}
        />
      )}
    </div>
  )
}
