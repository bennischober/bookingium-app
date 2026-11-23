import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, FolderOpen, Loader2, TriangleAlert } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { SearchableSelect } from '@/components/ui/searchable-select'
import type {
  ArchiveApplyResultDto,
  ArchivePreviewDto,
  ArchiveShowDto
} from '../../../../main/api/schemas/archive.schema'
import { t, uiLocale } from '../../../../main/i18n/translate'

type Row = ArchiveShowDto & {
  include: boolean
  /** The date to use (the folder's, the contract's, or typed in) */
  useDate: string
  eventTitle: string
  preview: ArchivePreviewDto | null
  previewError: string | null
  result: ArchiveApplyResultDto | null
  applyError: string | null
}

type Step = 'setup' | 'review' | 'done'

const money = (cents: number) =>
  (cents / 100).toLocaleString(uiLocale(), { style: 'currency', currency: 'EUR' })

/**
 * "Booking-Archiv einlesen" (Import menu): a band's old booking folders, one per show, at once.
 * Every show gets its event (found by band and date or created, archived when past); festival,
 * promoter and billing company are found or created, and only empty fields are filled. Travel
 * papers and copies are never filed.
 */
export function ArchiveImportDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const utils = trpcReact.useUtils()
  const bands = trpcReact.band.getListItems.useQuery(undefined, { enabled: open })
  const [step, setStep] = useState<Step>('setup')
  const [bandId, setBandId] = useState<number | null>(null)
  const [root, setRoot] = useState('')
  const [fileDocuments, setFileDocuments] = useState(true)
  const [rows, setRows] = useState<Row[]>([])
  const [applying, setApplying] = useState(false)
  const cancelled = useRef(false)

  const chooseRoot = trpcReact.archive.chooseRoot.useMutation({
    onSuccess: (folder) => folder && setRoot(folder)
  })
  const scan = trpcReact.archive.scan.useMutation({
    onError: (error) =>
      toast.error(t('Ordner konnte nicht gelesen werden'), { description: error.message })
  })
  const preview = trpcReact.archive.preview.useMutation()
  const apply = trpcReact.archive.apply.useMutation()

  const patch = (path: string, change: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.path === path ? { ...row, ...change } : row)))

  const reset = () => {
    cancelled.current = true
    setStep('setup')
    setRows([])
    setApplying(false)
  }

  const close = () => {
    if (applying) return
    reset()
    onOpenChange(false)
  }

  // the previews, one show after the other, so the list fills while the files are read
  const loading = rows.filter((row) => row.preview === null && row.previewError === null).length
  useEffect(() => {
    if (step !== 'review' || bandId === null) return
    cancelled.current = false
    const pending = rows.filter((row) => row.preview === null && row.previewError === null)
    if (pending.length === 0) return
    void (async () => {
      for (const row of pending) {
        if (cancelled.current) return
        try {
          const result = await preview.mutateAsync({ path: row.path, bandId })
          setRows((current) =>
            current.map((item) =>
              item.path !== row.path
                ? item
                : {
                    ...item,
                    preview: result,
                    useDate: item.useDate || result.contractDate,
                    include: item.include || (!item.useDate && result.contractDate !== ''),
                    eventTitle: item.eventName ?? (result.place.name || item.eventTitle)
                  }
            )
          )
        } catch (error) {
          patch(row.path, { previewError: error instanceof Error ? error.message : String(error) })
        }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, bandId])

  const startScan = async () => {
    if (bandId === null || !root) return
    const shows = await scan.mutateAsync({ root, bandId }).catch(() => null)
    if (!shows) return
    setRows(
      shows.map((show) => ({
        ...show,
        include: show.date !== '',
        useDate: show.date,
        eventTitle: show.eventName ?? (show.title || show.folderName),
        preview: null,
        previewError: null,
        result: null,
        applyError: null
      }))
    )
    setStep('review')
  }

  const chosen = rows.filter((row) => row.include && /^\d{4}-\d{2}-\d{2}$/.test(row.useDate))
  const startApply = async () => {
    if (bandId === null) return
    setApplying(true)
    // newest first: the newest information fills empty fields, older folders never overwrite it
    const ordered = [...chosen].sort((a, b) => b.useDate.localeCompare(a.useDate))
    for (const row of ordered) {
      try {
        const result = await apply.mutateAsync({
          path: row.path,
          bandId,
          date: row.useDate,
          endDate: row.endDate,
          eventName: row.eventTitle.trim() || row.folderName,
          eventId: row.eventId,
          fileDocuments
        })
        patch(row.path, { result })
      } catch (error) {
        patch(row.path, { applyError: error instanceof Error ? error.message : String(error) })
      }
    }
    setApplying(false)
    setStep('done')
    void utils.invalidate()
  }

  const done = rows.filter((row) => row.result)
  const failed = rows.filter((row) => row.applyError)

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="flex max-h-[calc(100vh-4rem)] w-[calc(100vw-2rem)] max-w-6xl flex-col">
        <DialogHeader>
          <DialogTitle>{t('Booking-Archiv einlesen')}</DialogTitle>
          <DialogDescription>
            {t(
              'Alte Booking-Ordner einer Band auf einmal: je Show ein Ordner. Events, Festivals und Firmen werden gefunden oder angelegt, bestehende nur in leeren Feldern ergänzt. Pässe, Tickets und Kopien werden nie abgelegt.'
            )}
          </DialogDescription>
        </DialogHeader>

        {step === 'setup' && (
          <div className="space-y-5">
            <div className="space-y-1">
              <Label htmlFor="archive-band">{t('Band')}</Label>
              <SearchableSelect
                id="archive-band"
                value={bandId}
                onChange={setBandId}
                options={(bands.data ?? []).map((band) => ({ value: band.id, label: band.name }))}
                placeholder={t('Band wählen…')}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('Ordner')}</Label>
              <div className="flex items-center gap-2">
                <p
                  className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
                  title={root}
                >
                  {root ||
                    t(
                      'Der Ordner mit den Show-Ordnern (auch mit Jahres-Ordnern dazwischen) oder ein einzelner Show-Ordner'
                    )}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => chooseRoot.mutate()}
                  disabled={chooseRoot.isPending}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t('Wählen…')}
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <Switch
                  id="archive-file-documents"
                  checked={fileDocuments}
                  onCheckedChange={setFileDocuments}
                />
                <Label htmlFor="archive-file-documents">
                  {t('Verträge und Rechnungen ablegen')}
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                {fileDocuments
                  ? t(
                      'Vertrag und eigene Rechnung kommen zu den Dokumenten des Events, alles andere wird nur gelesen.'
                    )
                  : t(
                      'Nur Daten auslesen: Es wird nichts abgelegt, die Ordner bleiben, wo sie sind.'
                    )}
              </p>
            </div>
          </div>
        )}

        {step !== 'setup' && (
          <div className="min-h-0 flex-1 overflow-auto rounded-md border">
            <table className="w-full text-sm" aria-label={t('Shows im Archiv')}>
              <thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="w-8 px-2 py-2" />
                  <th className="px-2 py-2">{t('Datum')}</th>
                  <th className="px-2 py-2">{t('Event')}</th>
                  <th className="px-2 py-2">{t('Festival / Club')}</th>
                  <th className="px-2 py-2">{t('Veranstalter')}</th>
                  <th className="px-2 py-2">{t('Rechnung an')}</th>
                  <th className="px-2 py-2 text-right">{t('Gage')}</th>
                  <th className="px-2 py-2">{t('Dateien')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ArchiveRow
                    key={row.path}
                    row={row}
                    disabled={step === 'done' || applying}
                    onChange={(change) => patch(row.path, change)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {step === 'done' && (
          <p className="text-sm" role="status">
            {t('{{done}} Shows übernommen, davon {{created}} Events neu angelegt.', {
              done: done.length,
              created: done.filter((row) => row.result?.createdEvent).length
            })}
            {failed.length > 0 && ` ${t('{{count}} nicht übernommen.', { count: failed.length })}`}
          </p>
        )}

        <DialogFooter className="items-center gap-2">
          {step === 'review' && loading > 0 && (
            <span className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('Liest Ordner … noch {{count}}', { count: loading })}
            </span>
          )}
          {step === 'setup' && (
            <>
              <Button variant="outline" onClick={close}>
                {t('Abbrechen')}
              </Button>
              <Button
                onClick={() => void startScan()}
                disabled={bandId === null || !root || scan.isPending}
              >
                {scan.isPending ? t('Sucht Show-Ordner…') : t('Ordner einlesen')}
              </Button>
            </>
          )}
          {step === 'review' && (
            <>
              <Button variant="outline" onClick={reset} disabled={applying}>
                {t('Zurück')}
              </Button>
              <Button onClick={() => void startApply()} disabled={applying || chosen.length === 0}>
                {applying
                  ? t('Übernimmt… {{done}} von {{total}}', {
                      done: done.length + failed.length,
                      total: chosen.length
                    })
                  : t('{{count}} Shows übernehmen', { count: chosen.length })}
              </Button>
            </>
          )}
          {step === 'done' && <Button onClick={close}>{t('Schließen')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ArchiveRow({
  row,
  disabled,
  onChange
}: {
  row: Row
  disabled: boolean
  onChange: (change: Partial<Row>) => void
}) {
  const p = row.preview
  const named = (value: { name: string; known: boolean } | null | undefined) =>
    value?.name ? (
      <span>
        {value.name}
        {!value.known && <span className="ml-1 text-xs text-muted-foreground">({t('neu')})</span>}
      </span>
    ) : (
      <span className="text-muted-foreground">–</span>
    )
  return (
    <tr className="border-b align-top last:border-0">
      <td className="px-2 py-2">
        <input
          type="checkbox"
          aria-label={t('{{name}} übernehmen', { name: row.folderName })}
          checked={row.include}
          disabled={disabled}
          onChange={(event) => onChange({ include: event.target.checked })}
        />
      </td>
      <td className="px-2 py-2 whitespace-nowrap">
        <Input
          type="date"
          className="h-8 w-36"
          value={row.useDate}
          disabled={disabled}
          aria-label={t('Datum von {{name}}', { name: row.folderName })}
          onChange={(event) => onChange({ useDate: event.target.value })}
        />
        {row.endDate && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t('bis {{date}}', { date: row.endDate.split('-').reverse().join('.') })}
          </p>
        )}
      </td>
      <td className="px-2 py-2">
        {row.eventId ? (
          <span>{row.eventName}</span>
        ) : (
          <Input
            className="h-8 min-w-40"
            value={row.eventTitle}
            disabled={disabled}
            aria-label={t('Name des neuen Events')}
            onChange={(event) => onChange({ eventTitle: event.target.value })}
          />
        )}
        <p className="mt-1 truncate text-xs text-muted-foreground" title={row.path}>
          {row.eventId ? t('vorhanden') : t('wird angelegt')} · {row.folderName}
        </p>
        {row.result && (
          <p className="mt-1 flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('{{changes}} Änderungen, {{documents}} Dokumente', {
              changes: row.result.changes,
              documents: row.result.documents
            })}
          </p>
        )}
        {[...(row.result?.problems ?? []), ...(row.applyError ? [row.applyError] : [])].map(
          (problem) => (
            <p key={problem} className="mt-1 flex items-center gap-1 text-xs text-destructive">
              <TriangleAlert className="h-3.5 w-3.5" />
              {problem}
            </p>
          )
        )}
      </td>
      {p ? (
        <>
          <td className="px-2 py-2">{named(p.place)}</td>
          <td className="px-2 py-2">{named(p.promoter)}</td>
          <td className="px-2 py-2">{named(p.recipient)}</td>
          <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">
            {p.guaranteeCents !== null ? money(p.guaranteeCents) : '–'}
          </td>
          <td className="px-2 py-2 text-xs text-muted-foreground">
            {t('{{total}} Dateien', { total: p.files.total })}
            {p.files.contracts + p.files.invoices > 0 &&
              ` · ${t('{{count}} Vertrag/Rechnung', { count: p.files.contracts + p.files.invoices })}`}
            {p.files.travel > 0 &&
              ` · ${t('{{count}} Reiseunterlagen', { count: p.files.travel })}`}
            {p.files.duplicates > 0 &&
              ` · ${t('{{count}} doppelt', { count: p.files.duplicates })}`}
            {p.files.unreadable > 0 &&
              ` · ${t('{{count}} ohne lesbaren Text', { count: p.files.unreadable })}`}
          </td>
        </>
      ) : (
        <td colSpan={5} className="px-2 py-2 text-xs text-muted-foreground">
          {row.previewError ?? t('Wird gelesen…')}
        </td>
      )}
    </tr>
  )
}
