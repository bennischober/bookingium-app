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
import { germanDate } from '@/components/map/mapDisplay'
import type { ImportFile } from '../../../../main/api/schemas/import.schema'
import type { DealMemoStatus } from '../../../../main/api/schemas/deal_memo.schema'
import type { VenueKind } from '../../../../main/api/schemas/venue.schema'
import {
  TOUR_IMPORT_FIELD_LABELS,
  TOUR_IMPORT_FIELDS,
  type TourImportAction,
  type TourImportField,
  type TourImportRequest,
  type TourImportResult
} from '../../../../main/api/schemas/tour_import.schema'

type Step = 'file' | 'mapping' | 'preview' | 'done'

/** The band Select's value for "take it from the Band column"; Radix refuses an empty value */
const NO_BAND = '__column__'
type Table = NonNullable<ImportFile['table']>

const ACTION_LABELS: Record<TourImportAction, string> = {
  new: 'neu',
  update: 'geändert',
  unchanged: 'unverändert',
  skipped: 'übersprungen'
}

const STATUS_LABELS: Record<DealMemoStatus, string> = {
  confirmed: 'Bestätigt',
  pending: 'Ausstehend',
  cancelled: 'Storniert'
}

const KIND_LABELS: Record<VenueKind, string> = { venue: 'Club', festival: 'Festival' }

/** Spreadsheet column letter: 0 → A, 26 → AA */
function columnLetter(index: number): string {
  let letter = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter
  }
  return letter
}

interface TourImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Tourdaten importieren: own events from a tour sheet (Excel or CSV). Pick the file, check the
 * columns and the tour, review the rows, import. An event is found again by band and date, so
 * the next version of the sheet updates instead of duplicating; a club or festival the app does
 * not know yet is created. Columns and defaults are remembered for sheets with the same columns.
 */
export function TourImportDialog({ open, onOpenChange }: TourImportDialogProps) {
  const utils = trpcReact.useUtils()
  const [step, setStep] = useState<Step>('file')
  const [picking, setPicking] = useState(false)
  const [fileName, setFileName] = useState('')
  const [table, setTable] = useState<Table | null>(null)
  const [mapping, setMapping] = useState<TourImportField[]>([])
  const [tour, setTour] = useState('')
  // The band of rows without a Band column (a sheet of one band)
  const [band, setBand] = useState('')
  const [defaultKind, setDefaultKind] = useState<VenueKind>('venue')
  const [defaultStatus, setDefaultStatus] = useState<DealMemoStatus>('confirmed')
  const [createVenues, setCreateVenues] = useState(true)
  const [remembered, setRemembered] = useState(false)
  const [result, setResult] = useState<TourImportResult | null>(null)

  const tours = trpcReact.tourImport.tours.useQuery(undefined, { enabled: open })
  const bands = trpcReact.band.getListItems.useQuery(undefined, { enabled: open })

  const reset = (): void => {
    setStep('file')
    setFileName('')
    setTable(null)
    setMapping([])
    setTour('')
    setBand('')
    setDefaultKind('venue')
    setDefaultStatus('confirmed')
    setCreateVenues(true)
    setRemembered(false)
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
        toast.error('Datei konnte nicht gelesen werden', { description: response.error })
        return
      }
      if (response.canceled || !response.file) return
      const picked = response.file.table
      if (!picked) {
        toast.error('Keine Daten gefunden', {
          description: 'Die Datei enthält keine Kopfzeile mit Datenzeilen darunter.'
        })
        return
      }
      const suggestion = await utils.tourImport.suggest.fetch({
        headers: picked.headers,
        title: picked.title,
        rows: picked.rows.map((row) => ({ cells: row.cells }))
      })
      setFileName(response.file.fileName)
      setTable(picked)
      setMapping(suggestion.mapping)
      setTour(suggestion.tour)
      setBand(suggestion.band)
      setDefaultKind(suggestion.defaultKind)
      setDefaultStatus(suggestion.defaultStatus)
      setRemembered(suggestion.remembered)
      setStep('mapping')
    } catch (error) {
      toast.error('Datei konnte nicht gelesen werden', {
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setPicking(false)
    }
  }

  const request: TourImportRequest | null = table
    ? {
        fileName,
        headers: table.headers,
        rows: table.rows,
        mapping,
        band,
        tour,
        defaultKind,
        defaultStatus,
        createVenues
      }
    : null

  const preview = trpcReact.tourImport.preview.useQuery(request as TourImportRequest, {
    enabled: step === 'preview' && request !== null,
    keepPreviousData: true,
    cacheTime: 0
  })

  const commit = trpcReact.tourImport.commit.useMutation({
    onSuccess: (imported) => {
      setResult(imported)
      setStep('done')
      void utils.dealMemo.invalidate()
      void utils.venue.invalidate()
      void utils.tourImport.tours.invalidate()
      void utils.map.invalidate()
    },
    onError: (error) => toast.error('Import fehlgeschlagen', { description: error.message })
  })

  // Single-value fields move to the newly chosen column; notes may take several
  const setColumnField = (column: number, field: TourImportField): void => {
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
    !mapping.includes('band') && !band && 'Band',
    !mapping.includes('date') && 'Datum'
  ].filter(Boolean)
  const previewData = preview.data
  const writes = previewData ? previewData.counts.new + previewData.counts.update : 0

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
          <DialogTitle>Tourdaten importieren</DialogTitle>
          <DialogDescription>
            {step === 'file' && 'Eigene Shows aus einer Tour-Tabelle als Events anlegen.'}
            {step === 'mapping' &&
              'Spalten und Tour prüfen. Band und Datum sind Pflicht; die Band muss angelegt sein.'}
            {step === 'preview' &&
              'Events mit gleicher Band und gleichem Datum werden aktualisiert, alle anderen neu angelegt.'}
            {step === 'done' && 'Der Import ist abgeschlossen.'}
          </DialogDescription>
        </DialogHeader>

        {/* ---- Step 1: file ---- */}
        {step === 'file' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <FileSpreadsheet className="h-12 w-12 text-muted-foreground" />
            <p className="max-w-md text-sm text-muted-foreground">
              Eine Zeile pro Show, mit Spalten wie Datum, Band, Club, PLZ, Ort, Status, Gage, Deal
              und Gebietsschutz (km, Wochen davor/danach). Excel-Dateien (.xlsx, erstes Blatt) und
              CSV gehen direkt. Clubs und Festivals, die es noch nicht gibt, werden angelegt.
            </p>
            <Button onClick={() => void pickFile()} disabled={picking}>
              {picking ? 'Datei wird gelesen…' : 'Datei auswählen…'}
            </Button>
          </div>
        )}

        {/* ---- Step 2: tour, defaults + column mapping ---- */}
        {step === 'mapping' && table && (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            {table.title && (
              <p className="text-sm text-muted-foreground">
                Titel der Tabelle:{' '}
                <span className="font-medium text-foreground">{table.title}</span>
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
              <div className="space-y-1.5">
                <Label htmlFor="tour-import-band">Band (für Zeilen ohne Band-Spalte)</Label>
                <Select
                  value={band || NO_BAND}
                  onValueChange={(value) => setBand(value === NO_BAND ? '' : value)}
                >
                  <SelectTrigger id="tour-import-band">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_BAND}>Aus der Band-Spalte</SelectItem>
                    {(bands.data ?? []).map((option) => (
                      <SelectItem key={option.id} value={option.name}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tour-import-tour">Tour</Label>
                <Input
                  id="tour-import-tour"
                  list="tour-import-tours"
                  value={tour}
                  onChange={(event) => setTour(event.target.value)}
                  placeholder="z. B. Frühjahr 2027"
                  maxLength={200}
                />
                <datalist id="tour-import-tours">
                  {(tours.data ?? []).map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tour-import-status">Status, wenn keiner angegeben</Label>
                <Select
                  value={defaultStatus}
                  onValueChange={(value) => setDefaultStatus(value as DealMemoStatus)}
                >
                  <SelectTrigger id="tour-import-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS_LABELS) as DealMemoStatus[]).map((option) => (
                      <SelectItem key={option} value={option}>
                        {STATUS_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tour-import-kind">Neue Orte sind</Label>
                <Select
                  value={defaultKind}
                  onValueChange={(value) => setDefaultKind(value as VenueKind)}
                >
                  <SelectTrigger id="tour-import-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(KIND_LABELS) as VenueKind[]).map((option) => (
                      <SelectItem key={option} value={option}>
                        {KIND_LABELS[option]}s (wenn keine Art angegeben)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label>Datei</Label>
                <p className="truncate py-2 text-sm" title={fileName}>
                  {fileName}{' '}
                  <span className="text-muted-foreground">
                    ({table.rows.length} {table.rows.length === 1 ? 'Zeile' : 'Zeilen'})
                  </span>
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={createVenues}
                onChange={(event) => setCreateVenues(event.target.checked)}
              />
              Clubs und Festivals, die es noch nicht gibt, anlegen (sonst steht der Ort in den
              Anmerkungen des Events)
            </label>

            {remembered && (
              <p className="text-sm text-muted-foreground">
                Tour und Zuordnung vom letzten Import einer Tabelle mit diesen Spalten übernommen.
              </p>
            )}
            {missingColumns.length > 0 && (
              <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Noch keine Spalte für: {missingColumns.join(', ')}
              </p>
            )}

            <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Spalte</th>
                    <th className="px-3 py-2 font-medium">Beispielwerte</th>
                    <th className="w-64 px-3 py-2 font-medium">Übernehmen als</th>
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
                        <span className="font-medium">{header || '(ohne Überschrift)'}</span>
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
                            setColumnField(column, value as TourImportField)
                          }
                        >
                          <SelectTrigger
                            className="h-8"
                            aria-label={`Spalte ${columnLetter(column)} übernehmen als`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TOUR_IMPORT_FIELDS.map((field) => (
                              <SelectItem key={field} value={field}>
                                {TOUR_IMPORT_FIELD_LABELS[field]}
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
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-6">
                {(
                  [
                    ['new', 'Neu'],
                    ['update', 'Geändert'],
                    ['unchanged', 'Unverändert'],
                    ['skipped', 'Übersprungen'],
                    ['newVenues', 'Neue Clubs/Festivals'],
                    ['newPromoters', 'Neue Veranstalter']
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="rounded-lg border px-3 py-2">
                    <div className="text-muted-foreground">{label}</div>
                    <div className="font-medium">{previewData.counts[key]}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
              {preview.isLoading ? (
                <p className="p-4 text-sm text-muted-foreground">Vorschau wird erstellt…</p>
              ) : preview.error ? (
                <p className="p-4 text-sm text-destructive">{preview.error.message}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-muted text-left">
                    <tr>
                      <th className="w-16 px-3 py-2 font-medium">Zeile</th>
                      <th className="px-3 py-2 font-medium">Datum</th>
                      <th className="px-3 py-2 font-medium">Band</th>
                      <th className="px-3 py-2 font-medium">Club / Festival</th>
                      <th className="px-3 py-2 font-medium">Ort</th>
                      <th className="px-3 py-2 font-medium">Veranstalter</th>
                      <th className="px-3 py-2 font-medium">Tour</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Import</th>
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
                        <td className="px-3 py-2 align-top">
                          {row.venueName || '–'}
                          {row.newVenue && (
                            <span className="block text-xs text-muted-foreground">
                              wird angelegt
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">{row.city || '–'}</td>
                        <td className="px-3 py-2 align-top">
                          {row.promoterName || '–'}
                          {row.newPromoter && (
                            <span className="block text-xs text-muted-foreground">
                              wird angelegt
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">{row.tour || '–'}</td>
                        <td className="px-3 py-2 align-top">
                          {row.action === 'skipped' ? '–' : STATUS_LABELS[row.status]}
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
              {result.created} neu · {result.updated} aktualisiert · {result.unchanged} unverändert
              {result.skipped > 0 && ` · ${result.skipped} übersprungen`}
              {result.promotersCreated + result.contactsCreated > 0 &&
                ` · ${result.promotersCreated} Veranstalter und ${result.contactsCreated} Ansprechpartner angelegt`}
              {result.venuesCreated > 0 &&
                ` · ${result.venuesCreated} ${result.venuesCreated === 1 ? 'Club/Festival' : 'Clubs/Festivals'} angelegt`}
            </p>
          </div>
        )}

        <DialogFooter>
          {step === 'mapping' && (
            <>
              <Button variant="outline" onClick={reset}>
                Andere Datei
              </Button>
              <Button onClick={() => setStep('preview')} disabled={missingColumns.length > 0}>
                Weiter zur Vorschau
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
                Zurück
              </Button>
              <Button
                onClick={() => request && commit.mutate(request)}
                disabled={
                  !previewData ||
                  previewData.errors.length > 0 ||
                  preview.isFetching ||
                  commit.isPending ||
                  writes === 0
                }
              >
                {commit.isPending ? 'Wird importiert…' : 'Importieren'}
              </Button>
            </>
          )}
          {step === 'done' && <Button onClick={close}>Schließen</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
