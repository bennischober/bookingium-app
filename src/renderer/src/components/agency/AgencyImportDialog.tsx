import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileSpreadsheet } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { ImportFile } from '../../../../main/api/schemas/import.schema'
import {
  EXTERNAL_BOOKING_FIELD_LABELS,
  EXTERNAL_BOOKING_FIELDS,
  EXTERNAL_BOOKING_KIND_LABELS,
  EXTERNAL_BOOKING_STATUS_LABELS,
  ExternalBookingKind,
  type ExternalBookingField,
  type ExternalBookingImportAction,
  type ExternalBookingImportRequest,
  type ExternalBookingImportResult
} from '../../../../main/api/schemas/external_booking.schema'
import { germanDate } from '@/components/map/mapDisplay'
import { t } from '../../../../main/i18n/translate'

type Step = 'file' | 'mapping' | 'preview' | 'done'
type Table = NonNullable<ImportFile['table']>

const ACTION_LABELS: Record<ExternalBookingImportAction, string> = {
  new: 'neu',
  update: t('geändert'),
  unchanged: t('unverändert'),
  skipped: t('übersprungen')
}

/** Spreadsheet column letter: 0 → A, 26 → AA */
function columnLetter(index: number): string {
  let letter = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter
  }
  return letter
}

interface AgencyImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * #103: imports the shows another agency booked for the user's bands from its
 * export (CSV or .xlsx). Pick the file, name the
 * agency and check the columns, review the rows, import. A row is found again
 * by the agency and its booking number (else band, date and place), so the
 * next export of the same agency updates instead of duplicating; bookings the
 * file no longer lists are removed only when asked to. Columns and agency are
 * remembered for exports with the same columns.
 */
export function AgencyImportDialog({ open, onOpenChange }: AgencyImportDialogProps) {
  const utils = trpcReact.useUtils()
  const [step, setStep] = useState<Step>('file')
  const [picking, setPicking] = useState(false)
  const [fileName, setFileName] = useState('')
  const [table, setTable] = useState<Table | null>(null)
  const [mapping, setMapping] = useState<ExternalBookingField[]>([])
  const [agency, setAgency] = useState('')
  const [defaultKind, setDefaultKind] = useState<ExternalBookingKind>('venue')
  const [remembered, setRemembered] = useState(false)
  const [removeMissing, setRemoveMissing] = useState(false)
  const [result, setResult] = useState<ExternalBookingImportResult | null>(null)

  const agencies = trpcReact.externalBooking.agencies.useQuery(undefined, { enabled: open })

  const reset = (): void => {
    setStep('file')
    setFileName('')
    setTable(null)
    setMapping([])
    setAgency('')
    setDefaultKind('venue')
    setRemembered(false)
    setRemoveMissing(false)
    setResult(null)
  }

  const close = (): void => {
    onOpenChange(false)
    reset()
  }

  const pickFile = async (): Promise<void> => {
    setPicking(true)
    try {
      const response = await window.api.pickImportFile()
      if (!response.success) {
        toast.error(t('Datei konnte nicht gelesen werden'), { description: response.error })
        return
      }
      if (response.canceled || !response.file) return
      const picked = response.file.table
      if (!picked) {
        toast.error(t('Keine Daten gefunden'), {
          description: t('Die Datei enthält keine Kopfzeile mit Datenzeilen darunter.')
        })
        return
      }
      const suggestion = await utils.externalBooking.suggestImport.fetch({
        headers: picked.headers
      })
      setFileName(response.file.fileName)
      setTable(picked)
      setMapping(suggestion.mapping)
      setAgency(suggestion.agency)
      setDefaultKind(suggestion.defaultKind)
      setRemembered(suggestion.remembered)
      setRemoveMissing(false)
      setStep('mapping')
    } catch (error) {
      toast.error(t('Datei konnte nicht gelesen werden'), {
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setPicking(false)
    }
  }

  const request: ExternalBookingImportRequest | null = table
    ? {
        fileName,
        agency,
        headers: table.headers,
        rows: table.rows,
        mapping,
        defaultKind,
        removeMissing
      }
    : null

  const preview = trpcReact.externalBooking.previewImport.useQuery(
    request as ExternalBookingImportRequest,
    {
      enabled: step === 'preview' && request !== null && agency.trim() !== '',
      keepPreviousData: true,
      cacheTime: 0
    }
  )

  const commit = trpcReact.externalBooking.commitImport.useMutation({
    onSuccess: (imported) => {
      setResult(imported)
      setStep('done')
      void utils.externalBooking.invalidate()
      void utils.map.invalidate()
    },
    onError: (error) => toast.error(t('Import fehlgeschlagen'), { description: error.message })
  })

  // Single-value fields move to the newly chosen column; notes may take several
  const setColumnField = (column: number, field: ExternalBookingField): void => {
    setMapping((current) =>
      current.map((mapped, index) => {
        if (index === column) return field
        if (mapped === field && field !== 'notes') return 'ignore'
        return mapped
      })
    )
  }

  const samples = useMemo(
    () =>
      table
        ? table.headers.map((_, column) =>
            table.rows
              .map((row) => row.cells[column])
              .filter(Boolean)
              .slice(0, 3)
          )
        : [],
    [table]
  )

  const missingColumns = [
    !mapping.includes('band') && t('Band'),
    !mapping.includes('date') && t('Datum')
  ].filter(Boolean)
  const previewData = preview.data
  const writes = previewData
    ? previewData.counts.new +
      previewData.counts.update +
      (removeMissing ? previewData.counts.missing : 0)
    : 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (commit.isPending) return
        if (next) onOpenChange(true)
        else close()
      }}
    >
      <DialogContent className="flex h-[calc(100vh-4rem)] w-[calc(100vw-2rem)] max-w-5xl flex-col">
        <DialogHeader>
          <DialogTitle>{t('Agenturbuchungen importieren')}</DialogTitle>
          <DialogDescription>
            {step === 'file' &&
              t(
                'Shows Ihrer Bands, die eine andere Agentur gebucht hat, aus deren Export übernehmen.'
              )}
            {step === 'mapping' &&
              t(
                'Agentur angeben und die Spalten prüfen. Band und Datum sind Pflicht; die Band muss angelegt sein.'
              )}
            {step === 'preview' &&
              t(
                'Bekannte Buchungen (gleiche Agentur und Buchungs-Nr., sonst Band, Datum und Ort) werden aktualisiert.'
              )}
            {step === 'done' && t('Der Import ist abgeschlossen.')}
          </DialogDescription>
        </DialogHeader>

        {/* ---- Step 1: file ---- */}
        {step === 'file' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <FileSpreadsheet className="h-12 w-12 text-muted-foreground" />
            <p className="max-w-md text-sm text-muted-foreground">
              {t(
                'Eine Zeile pro Show, mit Spalten wie Band, Datum, Club, PLZ, Ort und Status. Agenturbuchungen sind schreibgeschützt: Sie zählen für Terminkonflikte und den Gebietsschutz, aber nie für Rechnungen, Verträge, Abrechnungen, Verteiler oder Wiedervorlagen. Excel-Dateien (.xlsx, erstes Blatt) und CSV gehen direkt.'
              )}
            </p>
            <Button onClick={() => void pickFile()} disabled={picking}>
              {picking ? t('Datei wird gelesen…') : t('Datei auswählen…')}
            </Button>
          </div>
        )}

        {/* ---- Step 2: agency + column mapping ---- */}
        {step === 'mapping' && table && (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="agency-import-agency">{t('Agentur')}</Label>
                <Input
                  id="agency-import-agency"
                  list="agency-import-agencies"
                  value={agency}
                  onChange={(event) => setAgency(event.target.value)}
                  placeholder={t('Name der Agentur')}
                  maxLength={200}
                />
                <datalist id="agency-import-agencies">
                  {(agencies.data ?? []).map((entry) => (
                    <option key={entry.agency} value={entry.agency} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agency-import-kind">{t('Art, wenn keine angegeben')}</Label>
                <Select
                  value={defaultKind}
                  onValueChange={(value) => setDefaultKind(value as ExternalBookingKind)}
                >
                  <SelectTrigger id="agency-import-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ExternalBookingKind.options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {EXTERNAL_BOOKING_KIND_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label>{t('Datei')}</Label>
                <p className="truncate py-2 text-sm" title={fileName}>
                  {fileName}{' '}
                  <span className="text-muted-foreground">
                    ({table.rows.length} {table.rows.length === 1 ? t('Zeile') : t('Zeilen')})
                  </span>
                </p>
              </div>
            </div>

            {remembered && (
              <p className="text-sm text-muted-foreground">
                {t(
                  'Agentur und Zuordnung vom letzten Import eines Exports mit diesen Spalten übernommen.'
                )}
              </p>
            )}
            {missingColumns.length > 0 && (
              <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {t('Noch keine Spalte für:')} {missingColumns.join(', ')}
              </p>
            )}

            <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('Spalte')}</th>
                    <th className="px-3 py-2 font-medium">{t('Beispielwerte')}</th>
                    <th className="w-64 px-3 py-2 font-medium">{t('Übernehmen als')}</th>
                  </tr>
                </thead>
                <tbody>
                  {table.headers.map((header, column) => (
                    <tr
                      key={column}
                      className={cn(
                        'border-t',
                        mapping[column] === 'ignore' && 'text-muted-foreground'
                      )}
                    >
                      <td className="whitespace-nowrap px-3 py-2 align-top">
                        <span className="mr-2 font-mono text-xs text-muted-foreground">
                          {columnLetter(column)}
                        </span>
                        <span className="font-medium">{header || t('(ohne Überschrift)')}</span>
                      </td>
                      <td className="max-w-0 px-3 py-2 align-top">
                        <span className="block truncate" title={samples[column]?.join(' · ')}>
                          {samples[column]?.join(' · ') || '–'}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 align-top">
                        <Select
                          value={mapping[column] ?? 'ignore'}
                          onValueChange={(value) =>
                            setColumnField(column, value as ExternalBookingField)
                          }
                        >
                          <SelectTrigger
                            className="h-8"
                            aria-label={t('Spalte {{columnLetter}} übernehmen als', {
                              columnLetter: columnLetter(column)
                            })}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {EXTERNAL_BOOKING_FIELDS.map((field) => (
                              <SelectItem key={field} value={field}>
                                {EXTERNAL_BOOKING_FIELD_LABELS[field]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ---- Step 3: preview ---- */}
        {step === 'preview' && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {previewData && previewData.errors.length > 0 && (
              <p className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {previewData.errors.join(' ')}
              </p>
            )}
            {previewData && (
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                {(
                  [
                    ['new', t('Neu')],
                    ['update', t('Geändert')],
                    ['unchanged', t('Unverändert')],
                    ['skipped', t('Übersprungen')]
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="rounded-lg border px-3 py-2">
                    <div className="text-muted-foreground">{label}</div>
                    <div className="font-medium">{previewData.counts[key]}</div>
                  </div>
                ))}
              </div>
            )}

            {previewData && previewData.missing.length > 0 && (
              <div className="space-y-2 rounded-lg border px-3 py-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={removeMissing}
                    onChange={(event) => setRemoveMissing(event.target.checked)}
                  />
                  {previewData.missing.length}{' '}
                  {previewData.missing.length === 1
                    ? t('Buchung dieser Agentur steht nicht mehr in der Datei – entfernen')
                    : t('Buchungen dieser Agentur stehen nicht mehr in der Datei – entfernen')}
                </label>
                <ul className="max-h-24 overflow-y-auto text-muted-foreground">
                  {previewData.missing.map((entry) => (
                    <li key={entry.id} className={cn(removeMissing && 'line-through')}>
                      {germanDate(entry.date)} · {entry.bandName}
                      {(entry.venueName || entry.city) &&
                        ` · ${[entry.venueName, entry.city].filter(Boolean).join(', ')}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
              {preview.isLoading ? (
                <p className="p-4 text-sm text-muted-foreground">{t('Vorschau wird erstellt…')}</p>
              ) : preview.error ? (
                <p className="p-4 text-sm text-destructive">{preview.error.message}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-muted text-left">
                    <tr>
                      <th className="w-16 px-3 py-2 font-medium">{t('Zeile')}</th>
                      <th className="px-3 py-2 font-medium">{t('Datum')}</th>
                      <th className="px-3 py-2 font-medium">{t('Band')}</th>
                      <th className="px-3 py-2 font-medium">{t('Club / Festival')}</th>
                      <th className="px-3 py-2 font-medium">{t('Ort')}</th>
                      <th className="px-3 py-2 font-medium">{t('Status')}</th>
                      <th className="px-3 py-2 font-medium">{t('Import')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(previewData?.rows ?? []).map((row) => (
                      <tr
                        key={row.rowNumber}
                        className={cn(
                          'border-t',
                          row.action === 'skipped' && 'text-muted-foreground'
                        )}
                      >
                        <td className="px-3 py-2 align-top text-muted-foreground">
                          {row.rowNumber}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 align-top">
                          {row.date ? germanDate(row.date) : '–'}
                        </td>
                        <td className="px-3 py-2 align-top">{row.bandName || '–'}</td>
                        <td className="px-3 py-2 align-top">{row.venueName || '–'}</td>
                        <td className="px-3 py-2 align-top">{row.city || '–'}</td>
                        <td className="px-3 py-2 align-top">
                          {row.action === 'skipped'
                            ? '–'
                            : EXTERNAL_BOOKING_STATUS_LABELS[row.status]}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <Badge
                            variant={row.action === 'new' ? 'default' : 'outline'}
                            className="px-1.5 py-0 text-[10px] font-normal"
                          >
                            {ACTION_LABELS[row.action]}
                          </Badge>
                          {row.reason && (
                            <span className="block text-xs text-muted-foreground">
                              {row.reason}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ---- Step 4: done ---- */}
        {step === 'done' && result && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-600" />
            <p className="text-sm">
              {result.created} {t('neu ·')} {result.updated} {t('aktualisiert ·')}{' '}
              {result.unchanged} {t('unverändert')}
              {result.removed > 0 && t(' · {{removed}} entfernt', { removed: result.removed })}
              {result.skipped > 0 && t(' · {{skipped}} übersprungen', { skipped: result.skipped })}
            </p>
          </div>
        )}

        <DialogFooter>
          {step === 'mapping' && (
            <>
              <Button variant="outline" onClick={reset}>
                {t('Andere Datei')}
              </Button>
              <Button
                onClick={() => setStep('preview')}
                disabled={!agency.trim() || missingColumns.length > 0}
              >
                {t('Weiter zur Vorschau')}
              </Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button
                variant="outline"
                onClick={() => setStep('mapping')}
                disabled={commit.isPending}
              >
                {t('Zurück')}
              </Button>
              <Button
                onClick={() => request && commit.mutate(request)}
                disabled={
                  !previewData ||
                  previewData.errors.length > 0 ||
                  preview.isFetching ||
                  commit.isPending ||
                  (writes === 0 && previewData.counts.unchanged === 0)
                }
              >
                {commit.isPending ? t('Wird importiert…') : t('Importieren')}
              </Button>
            </>
          )}
          {step === 'done' && <Button onClick={close}>{t('Schließen')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
