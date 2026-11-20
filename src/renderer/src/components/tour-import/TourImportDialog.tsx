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
import type { DealMemoStatus } from '../../../../main/api/schemas/deal_memo.schema'
import type { VenueKind } from '../../../../main/api/schemas/venue.schema'
import { detectTourMapping } from '../../../../main/import/tourDates'
import { ImportFileStep } from '@/components/import/ImportFileStep'
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
type Sheet = { name: string; table: Table }

/** New clubs and festivals: created as clubs, as festivals, or not at all */
type VenueMode = VenueKind | 'none'

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

const VENUE_MODE_LABELS: Record<VenueMode, string> = {
  venue: 'als Club anlegen',
  festival: 'als Festival anlegen',
  none: 'nicht anlegen'
}

// Rows of the sheet shown under the column choice
const SAMPLE_ROWS = 5

/** Spreadsheet column letter: 0 → A, 26 → AA */
function columnLetter(index: number): string {
  let letter = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter
  }
  return letter
}

/** "Fr., 30.10.2026" */
function showDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

/** The sheet a tour import starts on: the first whose cells hold show dates */
function startSheet(sheets: Sheet[]): Sheet {
  return (
    sheets.find(({ table }) => detectTourMapping(table.headers, table.rows).includes('date')) ??
    sheets[0]
  )
}

interface TourImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Tourdaten importieren: own events from a tour sheet (Excel or CSV). Pick the file (and the
 * sheet of a workbook with several), check band, tour and columns, review the rows, import. An
 * event is found again by band and date, so the next version of the sheet updates instead of
 * duplicating; a club or festival the app does not know yet is created. Columns and defaults
 * are remembered for sheets with the same columns.
 */
export function TourImportDialog({ open, onOpenChange }: TourImportDialogProps) {
  const utils = trpcReact.useUtils()
  const [step, setStep] = useState<Step>('file')
  const [picking, setPicking] = useState(false)
  const [fileName, setFileName] = useState('')
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [table, setTable] = useState<Table | null>(null)
  const [mapping, setMapping] = useState<TourImportField[]>([])
  const [tour, setTour] = useState('')
  // The band of rows without a Band column (a sheet of one band)
  const [band, setBand] = useState('')
  const [venueMode, setVenueMode] = useState<VenueMode>('venue')
  const [defaultStatus, setDefaultStatus] = useState<DealMemoStatus>('confirmed')
  const [remembered, setRemembered] = useState(false)
  const [result, setResult] = useState<TourImportResult | null>(null)

  const tours = trpcReact.tourImport.tours.useQuery(undefined, { enabled: open })
  const bands = trpcReact.band.getListItems.useQuery(undefined, { enabled: open })

  const reset = (): void => {
    setStep('file')
    setFileName('')
    setSheets([])
    setTable(null)
    setMapping([])
    setTour('')
    setBand('')
    setVenueMode('venue')
    setDefaultStatus('confirmed')
    setRemembered(false)
    setResult(null)
  }

  const close = (): void => {
    onOpenChange(false)
    reset()
  }

  /** Opens a sheet: its columns, band and tour as suggested (remembered or detected) */
  const openSheet = async (picked: Table): Promise<void> => {
    const suggestion = await utils.tourImport.suggest.fetch({
      headers: picked.headers,
      title: picked.title,
      rows: picked.rows.map((row) => ({ cells: row.cells }))
    })
    setTable(picked)
    setMapping(suggestion.mapping)
    // A sheet without a title keeps what the first sheet said
    if (suggestion.tour || !tour) setTour(suggestion.tour)
    if (suggestion.band || !band) setBand(suggestion.band)
    setVenueMode(suggestion.defaultKind)
    setDefaultStatus(suggestion.defaultStatus)
    setRemembered(suggestion.remembered)
  }

  const pickFile = async (droppedPath?: string): Promise<void> => {
    setPicking(true)
    try {
      const response = await window.api.pickImportFile(droppedPath)
      if (!response.success) {
        toast.error('Datei konnte nicht gelesen werden', { description: response.error })
        return
      }
      if (response.canceled || !response.file) return
      const file = response.file
      const readable: Sheet[] = (
        file.sheets.length > 0 ? file.sheets : [{ name: '', table: file.table }]
      ).flatMap((sheet) => (sheet.table ? [{ name: sheet.name, table: sheet.table }] : []))
      if (readable.length === 0) {
        toast.error('Keine Daten gefunden', {
          description: 'Die Datei enthält keine Tabelle mit Datenzeilen.'
        })
        return
      }
      setFileName(file.fileName)
      setSheets(readable)
      await openSheet(startSheet(readable).table)
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
        defaultKind: venueMode === 'festival' ? 'festival' : 'venue',
        defaultStatus,
        createVenues: venueMode !== 'none'
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

  // Columns with nothing in them (formatting reaching further right) are not offered
  const columns = useMemo(
    () =>
      table
        ? table.headers
            .map((header, index) => ({ header, index }))
            .filter(({ header, index }) =>
              header.trim() !== '' && !/^Spalte [A-Z]+$/.test(header)
                ? true
                : table.rows.some((row) => (row.cells[index] ?? '').trim() !== '')
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
  // Band and tour shown once above the rows when every row has the same
  const previewRows = previewData?.rows ?? []
  const varies = (pick: (row: (typeof previewRows)[number]) => string): boolean =>
    new Set(previewRows.filter((row) => row.action !== 'skipped').map(pick)).size > 1
  const showBand = varies((row) => row.bandName)
  const showTour = varies((row) => row.tour)
  const firstRow = previewRows.find((row) => row.action !== 'skipped')
  const showDetails = previewRows.some((row) => row.details)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (commit.isPending) return
        if (next) onOpenChange(true)
        else close()
      }}
    >
      <DialogContent className="flex h-[calc(100vh-4rem)] w-[calc(100vw-2rem)] max-w-6xl flex-col">
        <DialogHeader>
          <DialogTitle>Tourdaten importieren</DialogTitle>
          <DialogDescription>
            {step === 'file' && 'Eigene Shows aus einer Tour-Tabelle als Events anlegen.'}
            {step === 'mapping' &&
              'Band und Tour wählen und prüfen, welche Spalte was enthält. Pflicht sind Band und Datum.'}
            {step === 'preview' &&
              'Events mit gleicher Band und gleichem Datum werden aktualisiert, alle anderen neu angelegt.'}
            {step === 'done' && 'Der Import ist abgeschlossen.'}
          </DialogDescription>
        </DialogHeader>

        {/* ---- Step 1: file ---- */}
        {step === 'file' && (
          <ImportFileStep
            picking={picking}
            onPick={pickFile}
            description="Eine Zeile pro Show: Datum, Ort, Club und gern Veranstalter, Ansprechpartner, Status oder Gage. Eine Titelzeile über der Tabelle und fehlende Spaltenüberschriften sind in Ordnung. Excel (.xlsx, jedes Blatt) und CSV."
          />
        )}

        {/* ---- Step 2: band, tour, defaults + columns ---- */}
        {step === 'mapping' && table && (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="max-w-72 truncate font-medium" title={fileName}>
                {fileName}
              </span>
              {sheets.length > 1 && (
                <Select
                  value={String(sheets.findIndex((sheet) => sheet.table === table))}
                  onValueChange={(value) => void openSheet(sheets[Number(value)].table)}
                >
                  <SelectTrigger className="h-8 w-48" aria-label="Tabellenblatt">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sheets.map((sheet, index) => (
                      <SelectItem key={index} value={String(index)}>
                        Blatt „{sheet.name}“
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <span className="text-muted-foreground">
                {table.rows.length} {table.rows.length === 1 ? 'Zeile' : 'Zeilen'}
                {table.title && <> · Titel „{table.title}“</>}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="tour-import-band">Band</Label>
                <Select
                  value={band || NO_BAND}
                  onValueChange={(value) => setBand(value === NO_BAND ? '' : value)}
                >
                  <SelectTrigger id="tour-import-band">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_BAND}>Aus einer Band-Spalte</SelectItem>
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
                  placeholder="z. B. Herbst 2026"
                  maxLength={200}
                />
                <datalist id="tour-import-tours">
                  {(tours.data ?? []).map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tour-import-status">Status</Label>
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
                <p className="text-xs text-muted-foreground">wenn die Zeile keinen nennt</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tour-import-venues">Unbekannte Clubs</Label>
                <Select
                  value={venueMode}
                  onValueChange={(value) => setVenueMode(value as VenueMode)}
                >
                  <SelectTrigger id="tour-import-venues">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(VENUE_MODE_LABELS) as VenueMode[]).map((option) => (
                      <SelectItem key={option} value={option}>
                        {VENUE_MODE_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {venueMode === 'none'
                    ? 'der Ort steht in den Anmerkungen'
                    : 'einmal pro Name und Ort'}
                </p>
              </div>
            </div>

            {(remembered || missingColumns.length > 0) && (
              <div className="space-y-1 text-sm">
                {remembered && (
                  <p className="text-muted-foreground">
                    Zuordnung vom letzten Import einer Tabelle mit diesen Spalten übernommen.
                  </p>
                )}
                {missingColumns.length > 0 && (
                  <p className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Noch offen: {missingColumns.join(', ')}
                    {!band && missingColumns.includes('Band') && ' (oben eine Band wählen)'}
                  </p>
                )}
              </div>
            )}

            {/* The sheet as it is, with the choice of what each column becomes on top */}
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
              <table className="w-max min-w-full text-sm" aria-label="Spalten der Tabelle">
                <thead className="sticky top-0 z-10 bg-muted text-left">
                  <tr>
                    {columns.map(({ header, index }) => (
                      <th key={index} className="min-w-44 px-2 pt-2 align-top font-normal">
                        <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                          {columnLetter(index)}
                        </span>
                        <span className="font-medium">
                          {/^Spalte [A-Z]+$/.test(header) ? '' : header}
                        </span>
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {columns.map(({ index }) => (
                      <th key={index} className="px-2 pt-1 pb-2 font-normal">
                        <Select
                          value={mapping[index] ?? 'ignore'}
                          onValueChange={(value) => setColumnField(index, value as TourImportField)}
                        >
                          <SelectTrigger
                            className={cn(
                              'h-8 bg-background',
                              mapping[index] === 'ignore' && 'text-muted-foreground'
                            )}
                            aria-label={`Spalte ${columnLetter(index)} übernehmen als`}
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
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.slice(0, SAMPLE_ROWS).map((row) => (
                    <tr key={row.rowNumber} className="border-t">
                      {columns.map(({ index }) => (
                        <td
                          key={index}
                          className={cn(
                            'max-w-60 truncate px-3 py-1.5',
                            mapping[index] === 'ignore' && 'text-muted-foreground/60'
                          )}
                          title={row.cells[index]}
                        >
                          {row.cells[index] || ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {table.rows.length > SAMPLE_ROWS && (
                    <tr className="border-t">
                      <td
                        colSpan={columns.length}
                        className="px-3 py-1.5 text-xs text-muted-foreground"
                      >
                        … und {table.rows.length - SAMPLE_ROWS} weitere Zeilen
                      </td>
                    </tr>
                  )}
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
              <p className="text-sm" aria-label="Zusammenfassung">
                {firstRow && !showBand && (
                  <span className="font-medium">
                    {firstRow.bandName}
                    {firstRow.tour && !showTour && ` · ${firstRow.tour}`}:{' '}
                  </span>
                )}
                {[
                  `${previewData.counts.new} neu`,
                  previewData.counts.update > 0 && `${previewData.counts.update} geändert`,
                  previewData.counts.unchanged > 0 && `${previewData.counts.unchanged} unverändert`,
                  previewData.counts.skipped > 0 && `${previewData.counts.skipped} übersprungen`
                ]
                  .filter(Boolean)
                  .join(' · ')}
                {(previewData.counts.newVenues > 0 || previewData.counts.newPromoters > 0) && (
                  <span className="text-muted-foreground">
                    {' '}
                    — legt{' '}
                    {[
                      previewData.counts.newVenues > 0 &&
                        `${previewData.counts.newVenues} ${previewData.counts.newVenues === 1 ? 'Club/Festival' : 'Clubs/Festivals'}`,
                      previewData.counts.newPromoters > 0 &&
                        `${previewData.counts.newPromoters} Veranstalter`
                    ]
                      .filter(Boolean)
                      .join(' und ')}{' '}
                    neu an
                  </span>
                )}
              </p>
            )}

            <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
              {preview.isLoading ? (
                <p className="p-4 text-sm text-muted-foreground">Vorschau wird erstellt…</p>
              ) : preview.error ? (
                <p className="p-4 text-sm text-destructive">{preview.error.message}</p>
              ) : (
                <table className="w-full text-sm" aria-label="Vorschau">
                  <thead className="sticky top-0 z-10 bg-muted text-left">
                    <tr>
                      <th className="w-14 px-3 py-2 font-medium">Zeile</th>
                      <th className="px-3 py-2 font-medium">Datum</th>
                      {showBand && <th className="px-3 py-2 font-medium">Band</th>}
                      <th className="px-3 py-2 font-medium">Ort</th>
                      <th className="px-3 py-2 font-medium">Club / Festival</th>
                      <th className="px-3 py-2 font-medium">Veranstalter</th>
                      {showTour && <th className="px-3 py-2 font-medium">Tour</th>}
                      {showDetails && (
                        <th className="px-3 py-2 font-medium">Advancing / Tickets</th>
                      )}
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Import</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row) => (
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
                        <td className="whitespace-nowrap px-3 py-2 align-top tabular-nums">
                          {row.date ? showDate(row.date) : '–'}
                        </td>
                        {showBand && <td className="px-3 py-2 align-top">{row.bandName || '–'}</td>}
                        <td className="px-3 py-2 align-top">{row.city || '–'}</td>
                        <td className="px-3 py-2 align-top">
                          {row.venueName || '–'}
                          {row.newVenue && (
                            <span className="block text-xs text-muted-foreground">
                              wird angelegt
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {row.promoterName || '–'}
                          {row.newPromoter && (
                            <span className="block text-xs text-muted-foreground">
                              wird angelegt
                            </span>
                          )}
                        </td>
                        {showTour && <td className="px-3 py-2 align-top">{row.tour || '–'}</td>}
                        {showDetails && (
                          <td className="px-3 py-2 align-top text-xs">{row.details || '–'}</td>
                        )}
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
