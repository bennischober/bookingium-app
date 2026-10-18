import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import {
  IMPORT_COUNTRY_OPTIONS,
  IMPORT_FIELD_LABELS,
  ImportField,
  MULTI_COLUMN_FIELDS,
  type ImportEntityRef,
  type ImportRequest,
  type ImportResult,
  type ImportWorkbook
} from '../../../../main/api/schemas/import.schema'
import { VENUE_KIND_LABELS, VenueKind } from '../../../../main/api/schemas/venue.schema'

type Step = 'file' | 'mapping' | 'preview' | 'done'

const NO_COUNTRY = 'none'

const KIND_PLURALS: Record<VenueKind, string> = {
  venue: 'Spielstätten',
  festival: 'Festivals'
}

/** Spreadsheet column letter: 0 → A, 26 → AA */
function columnLetter(index: number): string {
  let letter = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter
  }
  return letter
}

const ACTION_LABELS: Record<ImportEntityRef['action'], string> = {
  new: 'neu',
  existing: 'vorhanden',
  repeat: 'wie oben'
}

function EntityCell({ entity }: { entity: ImportEntityRef | null }) {
  if (!entity) return <span className="text-muted-foreground">–</span>
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="min-w-0 break-words">{entity.label}</span>
      <Badge
        variant={entity.action === 'new' ? 'default' : 'outline'}
        className={cn(
          'px-1.5 py-0 text-[10px] font-normal',
          entity.action === 'repeat' && 'opacity-60'
        )}
      >
        {ACTION_LABELS[entity.action]}
      </Badge>
    </span>
  )
}

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Imports venues/festivals, their promoter companies and contact persons from
 * an Excel sheet: pick a file, check the column mapping, review every row,
 * import. Existing records (same name) only get their empty fields filled.
 */
export function ImportDialog({ open, onOpenChange }: ImportDialogProps) {
  const utils = trpcReact.useUtils()
  const [step, setStep] = useState<Step>('file')
  const [picking, setPicking] = useState(false)
  const [workbook, setWorkbook] = useState<ImportWorkbook | null>(null)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [mapping, setMapping] = useState<ImportField[]>([])
  const [kind, setKind] = useState<VenueKind>('venue')
  const [defaultCountry, setDefaultCountry] = useState('')
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const [result, setResult] = useState<ImportResult | null>(null)

  const sheet = workbook?.sheets[sheetIndex] ?? null

  const reset = (): void => {
    setStep('file')
    setWorkbook(null)
    setResult(null)
    setExcluded(new Set())
  }

  const close = (): void => {
    onOpenChange(false)
    reset()
  }

  const selectSheet = (book: ImportWorkbook, index: number): void => {
    const next = book.sheets[index]
    setSheetIndex(index)
    setMapping(next.suggestedMapping)
    setKind(next.suggestedKind)
    setDefaultCountry(next.suggestedCountry)
    setExcluded(new Set())
  }

  const pickFile = async (): Promise<void> => {
    setPicking(true)
    try {
      const response = await window.api.pickImportWorkbook()
      if (!response.success) {
        toast.error('Datei konnte nicht gelesen werden', { description: response.error })
        return
      }
      if (response.canceled || !response.workbook) return
      if (response.workbook.sheets.length === 0) {
        toast.error('Keine Daten gefunden', {
          description: 'Die Datei enthält kein Blatt mit Kopfzeile und Datenzeilen.'
        })
        return
      }
      setWorkbook(response.workbook)
      selectSheet(response.workbook, 0)
      setStep('mapping')
    } finally {
      setPicking(false)
    }
  }

  const request: ImportRequest | null = sheet
    ? {
        headers: sheet.headers,
        rows: sheet.rows,
        mapping,
        options: { kind, defaultCountry },
        excludedRows: [...excluded]
      }
    : null

  const preview = trpcReact.dataImport.preview.useQuery(request as ImportRequest, {
    enabled: step === 'preview' && request !== null,
    keepPreviousData: true,
    cacheTime: 0
  })

  const commit = trpcReact.dataImport.commit.useMutation({
    onSuccess: (imported) => {
      setResult(imported)
      setStep('done')
      void utils.venue.invalidate()
      void utils.company.invalidate()
      void utils.person.invalidate()
      void utils.search.invalidate()
    },
    onError: (error) => {
      toast.error('Import fehlgeschlagen', { description: error.message })
    }
  })

  // Single-value fields move to the newly chosen column
  const setColumnField = (column: number, field: ImportField): void => {
    setMapping((current) =>
      current.map((mapped, index) => {
        if (index === column) return field
        if (mapped === field && !MULTI_COLUMN_FIELDS.includes(field)) return 'ignore'
        return mapped
      })
    )
  }

  const samples = useMemo(
    () =>
      sheet
        ? sheet.headers.map((_, column) =>
            sheet.rows
              .map((row) => row.cells[column])
              .filter(Boolean)
              .slice(0, 3)
          )
        : [],
    [sheet]
  )

  const toggleRow = (rowNumber: number): void => {
    setExcluded((current) => {
      const next = new Set(current)
      if (next.has(rowNumber)) next.delete(rowNumber)
      else next.add(rowNumber)
      return next
    })
  }

  const previewData = preview.data
  const importableRows =
    previewData?.rows.filter((row) => row.status === 'record' || row.status === 'continuation')
      .length ?? 0

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
          <DialogTitle>Daten importieren</DialogTitle>
          <DialogDescription>
            {step === 'file' &&
              'Spielstätten oder Festivals mit Veranstaltern und Ansprechpartnern aus einer Excel-Liste übernehmen.'}
            {step === 'mapping' &&
              'Prüfen Sie, welche Spalte wohin gehört. Die Zuordnung wurde aus den Spaltenüberschriften erkannt.'}
            {step === 'preview' &&
              'Jede Zeile wird zu einer Spielstätte, einem Veranstalter und Ansprechpartnern. Vorhandene Einträge werden nur ergänzt, nie überschrieben.'}
            {step === 'done' && 'Der Import ist abgeschlossen.'}
          </DialogDescription>
        </DialogHeader>

        {/* ---- Step 1: file ---- */}
        {step === 'file' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <FileSpreadsheet className="h-12 w-12 text-muted-foreground" />
            <p className="max-w-md text-sm text-muted-foreground">
              Eine Zeile pro Spielstätte oder Festival, mit Spalten wie Name, Ort, Veranstalter,
              Ansprechpartner, E-Mail, Telefon und Anschrift. Zeilen ohne Namen gelten als weitere
              Ansprechpartner der Zeile darüber.
            </p>
            <Button onClick={() => void pickFile()} disabled={picking}>
              {picking ? 'Datei wird gelesen…' : 'Excel-Datei auswählen…'}
            </Button>
          </div>
        )}

        {/* ---- Step 2: mapping ---- */}
        {step === 'mapping' && workbook && sheet && (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="import-sheet">Tabellenblatt</Label>
                <Select
                  value={String(sheetIndex)}
                  onValueChange={(value) => selectSheet(workbook, Number(value))}
                >
                  <SelectTrigger id="import-sheet">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {workbook.sheets.map((entry, index) => (
                      <SelectItem key={entry.name} value={String(index)}>
                        {entry.name} ({entry.rows.length} Zeilen)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="import-kind">Importieren als</Label>
                <Select value={kind} onValueChange={(value) => setKind(value as VenueKind)}>
                  <SelectTrigger id="import-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VenueKind.options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {VENUE_KIND_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="import-country">Land, wenn keins angegeben</Label>
                <Select
                  value={defaultCountry || NO_COUNTRY}
                  onValueChange={(value) => setDefaultCountry(value === NO_COUNTRY ? '' : value)}
                >
                  <SelectTrigger id="import-country">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_COUNTRY}>Keins</SelectItem>
                    {IMPORT_COUNTRY_OPTIONS.map((country) => (
                      <SelectItem key={country.code} value={country.code}>
                        {country.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Spalte</th>
                    <th className="px-3 py-2 font-medium">Beispielwerte</th>
                    <th className="w-60 px-3 py-2 font-medium">Übernehmen als</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.headers.map((header, column) => (
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
                          value={mapping[column]}
                          onValueChange={(value) => setColumnField(column, value as ImportField)}
                        >
                          <SelectTrigger
                            className="h-8"
                            aria-label={`Spalte ${columnLetter(column)} übernehmen als`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ImportField.options.map((field) => (
                              <SelectItem key={field} value={field}>
                                {IMPORT_FIELD_LABELS[field]}
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
            {previewData && (
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                {(
                  [
                    [KIND_PLURALS[kind], previewData.summary.venues],
                    ['Veranstalter', previewData.summary.companies],
                    ['Ansprechpartner', previewData.summary.persons]
                  ] as const
                ).map(([label, count]) => (
                  <div key={label} className="rounded-lg border px-3 py-2">
                    <div className="text-muted-foreground">{label}</div>
                    <div className="font-medium">
                      {count.new} neu · {count.existing} vorhanden
                    </div>
                  </div>
                ))}
              </div>
            )}

            {previewData?.errors.map((error) => (
              <div
                key={error}
                className="flex items-center gap-2 rounded-lg border border-destructive/50 px-3 py-2 text-sm text-destructive"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
              </div>
            ))}

            <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
              {preview.isLoading ? (
                <p className="p-4 text-sm text-muted-foreground">Vorschau wird berechnet…</p>
              ) : preview.isError ? (
                <p className="p-4 text-sm text-destructive">{preview.error.message}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-muted text-left">
                    <tr>
                      <th className="w-10 px-3 py-2">
                        <span className="sr-only">Importieren</span>
                      </th>
                      <th className="w-14 px-2 py-2 font-medium">Zeile</th>
                      <th className="px-2 py-2 font-medium">{VENUE_KIND_LABELS[kind]}</th>
                      <th className="px-2 py-2 font-medium">Veranstalter</th>
                      <th className="px-2 py-2 font-medium">Ansprechpartner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData?.rows.map((row) => {
                      const skipped = row.status === 'excluded' || row.status === 'orphan'
                      return (
                        <tr
                          key={row.rowNumber}
                          className={cn('border-t align-top', skipped && 'text-muted-foreground')}
                        >
                          <td className="px-3 py-2">
                            {row.status !== 'continuation' && row.status !== 'orphan' && (
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-primary"
                                checked={!excluded.has(row.rowNumber)}
                                onChange={() => toggleRow(row.rowNumber)}
                                aria-label={`Zeile ${row.rowNumber} importieren`}
                              />
                            )}
                          </td>
                          <td className="px-2 py-2 font-mono text-xs">{row.rowNumber}</td>
                          {row.status === 'continuation' ? (
                            <td colSpan={2} className="px-2 py-2 text-muted-foreground">
                              weiterer Kontakt zur Zeile darüber
                            </td>
                          ) : (
                            <>
                              <td className={cn('px-2 py-2', skipped && 'line-through')}>
                                {skipped ? (
                                  (row.venue?.label ?? '–')
                                ) : (
                                  <EntityCell entity={row.venue} />
                                )}
                              </td>
                              <td className={cn('px-2 py-2', skipped && 'line-through')}>
                                {skipped ? (
                                  (row.company?.label ?? '–')
                                ) : (
                                  <EntityCell entity={row.company} />
                                )}
                              </td>
                            </>
                          )}
                          <td className="px-2 py-2">
                            <div className="flex flex-col gap-1">
                              {row.persons.length === 0 && !skipped && (
                                <span className="text-muted-foreground">–</span>
                              )}
                              {row.persons.map((person, index) =>
                                skipped ? (
                                  <span key={index} className="line-through">
                                    {person.label}
                                  </span>
                                ) : (
                                  <EntityCell key={index} entity={person} />
                                )
                              )}
                              {row.warnings.map((warning) => (
                                <span
                                  key={warning}
                                  className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-500"
                                >
                                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                  {warning}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ---- Step 4: done ---- */}
        {step === 'done' && result && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <CheckCircle2 className="h-12 w-12 text-primary" />
            <div className="space-y-1 text-sm">
              <p>
                <strong>{result.venuesCreated}</strong> {KIND_PLURALS[kind]} angelegt,{' '}
                <strong>{result.venuesUpdated}</strong> ergänzt
              </p>
              <p>
                <strong>{result.companiesCreated}</strong> Veranstalter angelegt,{' '}
                <strong>{result.companiesUpdated}</strong> ergänzt
              </p>
              <p>
                <strong>{result.personsCreated}</strong> Ansprechpartner angelegt,{' '}
                <strong>{result.personsUpdated}</strong> ergänzt
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {step === 'mapping' && (
            <>
              <Button variant="outline" onClick={reset}>
                <ArrowLeft className="h-4 w-4" /> Andere Datei
              </Button>
              <Button onClick={() => setStep('preview')}>Weiter zur Vorschau</Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button
                variant="outline"
                onClick={() => setStep('mapping')}
                disabled={commit.isPending}
              >
                <ArrowLeft className="h-4 w-4" /> Zuordnung
              </Button>
              <Button
                onClick={() => request && commit.mutate(request)}
                disabled={
                  !previewData ||
                  preview.isFetching ||
                  previewData.errors.length > 0 ||
                  importableRows === 0 ||
                  commit.isPending
                }
              >
                {commit.isPending ? 'Importiert…' : `${importableRows} Zeilen importieren`}
              </Button>
            </>
          )}
          {step === 'done' && (
            <Button className="sm:ml-auto" onClick={close}>
              Schließen
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
