import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { formatShortDate } from '@/lib/utils'
import { useSyncedState } from '@/hooks/useSyncedState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { quotaOf, soldOf } from '../../../../main/advancing/advancing'
import type { ShowAdvancingDto } from '../../../../main/api/schemas/advancing.schema'
import { ExternalDoneToggle } from './ExternalDoneToggle'

const today = (): string => new Date().toISOString().slice(0, 10)
const count = (value: number): string => value.toLocaleString('de-DE')

/** The quota as typed: a number, or what stands instead ("warten auf Bestätigung") */
const quotaText = (show: ShowAdvancingDto): string =>
  show.quota !== null ? String(show.quota) : show.quotaNote

/** Sold of quota as a bar; over 100 % stays full */
export function UtilizationBar({ percent }: { percent: number | null }) {
  if (percent === null) return null
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="meter"
      aria-label="Auslastung"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={percent >= 90 ? 'h-full bg-green-600' : 'h-full bg-primary'}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  )
}

/**
 * #232: Tickets - the quota (Ticketkontingent) and the sales the promoter reports, newest first
 * with the change since the report before
 */
export function TicketsTab({ eventId }: { eventId: number }) {
  const utils = trpcReact.useUtils()
  const show = trpcReact.advancing.get.useQuery({ eventId })
  const loaded = show.data
  const [quota, setQuota] = useSyncedState(loaded ? quotaText(loaded) : '')
  const [reportDate, setReportDate] = useState(today())
  const [sold, setSold] = useState('')
  const [note, setNote] = useState('')

  const onSaved = (saved: ShowAdvancingDto): void => {
    utils.advancing.get.setData({ eventId }, saved)
    void utils.advancing.tour.invalidate()
  }
  const saveQuota = trpcReact.advancing.saveQuota.useMutation({
    onSuccess: (saved) => {
      onSaved(saved)
      toast.success('Kontingent gespeichert')
    },
    onError: (error) =>
      toast.error('Kontingent konnte nicht gespeichert werden', { description: error.message })
  })
  const saveReport = trpcReact.advancing.saveReport.useMutation({
    onSuccess: (saved) => {
      onSaved(saved)
      setSold('')
      setNote('')
      toast.success('Verkaufsmeldung gespeichert')
    },
    onError: (error) =>
      toast.error('Meldung konnte nicht gespeichert werden', { description: error.message })
  })
  const deleteReport = trpcReact.advancing.deleteReport.useMutation({
    onSuccess: () => {
      void utils.advancing.invalidate()
    }
  })

  if (show.isLoading || !loaded) {
    return <p className="text-sm text-muted-foreground">Wird geladen…</p>
  }
  if (show.error) return <p className="text-sm text-destructive">{show.error.message}</p>

  const parsedSold = soldOf(sold)
  const remaining =
    loaded.quota !== null && loaded.sold !== null ? loaded.quota - loaded.sold : null

  return (
    <div className="max-w-4xl space-y-6">
      <section className="grid gap-4 rounded-lg border p-4 md:grid-cols-3" aria-label="Kontingent">
        <div className="space-y-1.5">
          <Label htmlFor="ticket-quota">Kontingent</Label>
          <div className="flex gap-2">
            <Input
              id="ticket-quota"
              value={quota}
              onChange={(event) => setQuota(event.target.value)}
              placeholder="z. B. 200"
            />
            <Button
              variant="outline"
              disabled={quota.trim() === quotaText(loaded) || saveQuota.isPending}
              onClick={() => {
                const parsed = quotaOf(quota)
                saveQuota.mutate({ eventId, quota: parsed.quota, quotaNote: parsed.note })
              }}
            >
              Speichern
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Eine Zahl, oder was gilt („warten auf Bestätigung“)
          </p>
        </div>
        <div className="space-y-2 md:col-span-2">
          <p className="text-sm text-muted-foreground">Verkauft</p>
          <p className="text-2xl font-semibold tabular-nums">
            {loaded.sold === null ? '–' : count(loaded.sold)}
            {loaded.quota !== null && (
              <span className="text-base font-normal text-muted-foreground">
                {' '}
                von {count(loaded.quota)}
                {loaded.utilization !== null && ` · ${loaded.utilization} %`}
                {remaining !== null && remaining >= 0 && ` · ${count(remaining)} übrig`}
              </span>
            )}
          </p>
          <UtilizationBar percent={loaded.utilization} />
          {loaded.reports[0] && (
            <p className="text-xs text-muted-foreground">
              Stand {formatShortDate(loaded.reports[0].reportDate)}
            </p>
          )}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border p-4" aria-label="Verkaufsmeldungen">
        <h3 className="font-semibold">Verkaufsmeldungen</h3>
        <ExternalDoneToggle eventId={eventId} step="tickets" />
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (parsedSold === null) return
            saveReport.mutate({ eventId, reportDate, sold: parsedSold, note })
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="report-date">Stand vom</Label>
            <Input
              id="report-date"
              type="date"
              className="w-40"
              value={reportDate}
              onChange={(event) => setReportDate(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-sold">Verkauft</Label>
            <Input
              id="report-sold"
              inputMode="numeric"
              className="w-28"
              value={sold}
              onChange={(event) => setSold(event.target.value)}
            />
          </div>
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label htmlFor="report-note">Notiz</Label>
            <Input
              id="report-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="z. B. inkl. Gästeliste"
            />
          </div>
          <Button
            type="submit"
            disabled={parsedSold === null || !reportDate || saveReport.isPending}
          >
            Meldung hinzufügen
          </Button>
        </form>

        {loaded.reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Verkaufsmeldung.</p>
        ) : (
          <table className="w-full text-sm" aria-label="Meldungen">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1.5 font-medium">Stand</th>
                <th className="py-1.5 text-right font-medium">Verkauft</th>
                <th className="py-1.5 text-right font-medium">seit davor</th>
                <th className="py-1.5 pl-4 font-medium">Notiz</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loaded.reports.map((report, index) => {
                const before = loaded.reports[index + 1]
                const delta = before ? report.sold - before.sold : null
                return (
                  <tr key={report.id} className="border-t">
                    <td className="py-1.5">{formatShortDate(report.reportDate)}</td>
                    <td className="py-1.5 text-right tabular-nums">{count(report.sold)}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {delta === null ? '' : `${delta >= 0 ? '+' : ''}${count(delta)}`}
                    </td>
                    <td className="py-1.5 pl-4">{report.note}</td>
                    <td className="py-1.5 text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Meldung vom ${formatShortDate(report.reportDate)} löschen`}
                        onClick={() => deleteReport.mutate({ id: report.id })}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
