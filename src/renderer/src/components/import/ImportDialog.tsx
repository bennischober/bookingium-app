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
  IMPORT_TARGET_DESCRIPTIONS,
  IMPORT_TARGET_FIELDS,
  IMPORT_TARGET_LABELS,
  ImportTarget,
  MULTI_COLUMN_FIELDS,
  importFieldLabel,
  type ImportEntityRef,
  type ImportField,
  type ImportPreview,
  type ImportRequest,
  type ImportResult,
  type ImportWorkbook
} from '../../../../main/api/schemas/import.schema'
import { VENUE_KIND_LABELS, VenueKind } from '../../../../main/api/schemas/venue.schema'

type Step = 'file' | 'mapping' | 'preview' | 'done'
type Entity = keyof ImportPreview['summary']

const NO_COUNTRY = 'none'

const KIND_PLURALS: Record<VenueKind, string> = {
  venue: 'Spielstätten',
  festival: 'Festivals'
}

/** Preview columns per target (null = column not shown) */
const PREVIEW_COLUMNS: Record<
  ImportTarget,
  { primary: string | null; company: string; persons: string | null; continuation: string }
> = {
  venues: {
    primary: null, // Spielstätte / Festival, by kind
    company: 'Veranstalter',
    persons: 'Ansprechpartner',
    continuation: 'weiterer Kontakt zur Zeile darüber'
  },
  bands: {
    primary: 'Band',
    company: 'Firma',
    persons: 'Mitglieder',
    continuation: 'weitere Mitglieder der Band darüber'
  },
  companies: {
    primary: null,
    company: 'Firma',
    persons: 'Ansprechpartner',
    continuation: 'weiterer Kontakt zur Firma darüber'
  },
  persons: { primary: 'Person', company: 'Firma', persons: null, continuation: '' }
}

/** Record types a target creates, in summary order */
function summaryEntities(target: ImportTarget, kind: VenueKind): Array<[Entity, string]> {
  switch (target) {
    case 'venues':
      return [
        ['venues', KIND_PLURALS[kind]],
        ['companies', 'Veranstalter'],
        ['persons', 'Ansprechpartner']
      ]
    case 'bands':
      return [
        ['bands', 'Bands'],
        ['persons', 'Personen']
      ]
    case 'companies':
      return [
        ['companies', 'Firmen'],
        ['persons', 'Ansprechpartner']
      ]
    case 'persons':
      return [
        ['persons', 'Personen'],
        ['companies', 'Firmen']
      ]
  }
}

// "1 Band angelegt" (labels that differ in the singular)
const SINGULAR: Record<string, string> = {
  Spielstätten: 'Spielstätte',
  Festivals: 'Festival',
  Bands: 'Band',
  Firmen: 'Firma',
  Personen: 'Person'
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

function EntityCell({ entity, struck }: { entity: ImportEntityRef | null; struck: boolean }) {
  if (!entity) return <span className="text-muted-foreground">–</span>
  if (struck) return <span className="line-through">{entity.label}</span>
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
  /** What the list holds when opened from a list page (else detected) */
  target?: ImportTarget
}

/**
 * Imports a list from an Excel sheet: pick a file, choose what the list
 * holds (venues, bands, companies, persons) and check the column mapping,
 * review every row, import. Existing records (same name) only get their
 * empty fields filled. The mapping is remembered for lists with the same
 * columns.
 */
export function ImportDialog({ open, onOpenChange, target: fixedTarget }: ImportDialogProps) {
  const utils = trpcReact.useUtils()
  const [step, setStep] = useState<Step>('file')
  const [picking, setPicking] = useState(false)
  const [workbook, setWorkbook] = useState<ImportWorkbook | null>(null)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [target, setTarget] = useState<ImportTarget>(fixedTarget ?? 'venues')
  const [mapping, setMapping] = useState<ImportField[]>([])
  const [kind, setKind] = useState<VenueKind>('venue')
  const [defaultCountry, setDefaultCountry] = useState('')
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const [result, setResult] = useState<ImportResult | null>(null)

  const sheet = workbook?.sheets[sheetIndex] ?? null
  const columns = PREVIEW_COLUMNS[target]
  const primaryHeader = target === 'venues' ? VENUE_KIND_LABELS[kind] : columns.primary

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
    const nextTarget = fixedTarget ?? next.suggestedTarget
    setSheetIndex(index)
    setTarget(nextTarget)
    setMapping(next.suggestedMappings[nextTarget])
    setKind(next.suggestedKind)
    setDefaultCountry(next.suggestedCountry)
    setExcluded(new Set())
  }

  const selectTarget = (next: ImportTarget): void => {
    setTarget(next)
    if (sheet) setMapping(sheet.suggestedMappings[next])
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
        target,
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
      void utils.band.invalidate()
      void utils.company.invalidate()
      void utils.person.invalidate()
      void utils.relation.invalidate()
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
  const usesAddress = IMPORT_TARGET_FIELDS[target].includes('region')
  const showRemembered = sheet?.mappingRemembered && sheet.suggestedTarget === target

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
              'Eine Excel-Liste mit Spielstätten, Bands, Firmen oder Personen übernehmen.'}
            {step === 'mapping' && IMPORT_TARGET_DESCRIPTIONS[target]}
            {step === 'preview' &&
              'Vorhandene Einträge (gleicher Name) werden nur ergänzt, nie überschrieben. Zeilen abwählen, um sie auszulassen.'}
            {step === 'done' && 'Der Import ist abgeschlossen.'}
          </DialogDescription>
        </DialogHeader>

        {/* ---- Step 1: file ---- */}
        {step === 'file' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <FileSpreadsheet className="h-12 w-12 text-muted-foreground" />
            <p className="max-w-md text-sm text-muted-foreground">
              Eine Zeile pro Eintrag, mit Spaltenüberschriften wie Name, Firma, Ansprechpartner,
              E-Mail, Telefon und Anschrift. Im nächsten Schritt wählen Sie, was die Liste enthält,
              und prüfen die Zuordnung der Spalten.
            </p>
            <Button onClick={() => void pickFile()} disabled={picking}>
              {picking ? 'Datei wird gelesen…' : 'Excel-Datei auswählen…'}
            </Button>
          </div>
        )}

        {/* ---- Step 2: what the list holds + column mapping ---- */}
        {step === 'mapping' && workbook && sheet && (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="import-target">Liste enthält</Label>
                <Select
                  value={target}
                  onValueChange={(value) => selectTarget(value as ImportTarget)}
                >
                  <SelectTrigger id="import-target">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ImportTarget.options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {IMPORT_TARGET_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
              {target === 'venues' && (
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
              )}
              {usesAddress && (
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
              )}
            </div>

            {showRemembered && (
              <p className="text-sm text-muted-foreground">
                Zuordnung vom letzten Import einer Liste mit diesen Spalten übernommen.
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
                            {IMPORT_TARGET_FIELDS[target].map((field) => (
                              <SelectItem key={field} value={field}>
                                {importFieldLabel(field, target)}
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
                {summaryEntities(target, kind).map(([entity, label]) => (
                  <div key={entity} className="rounded-lg border px-3 py-2">
                    <div className="text-muted-foreground">{label}</div>
                    <div className="font-medium">
                      {previewData.summary[entity].new} neu · {previewData.summary[entity].existing}{' '}
                      vorhanden
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
                      {primaryHeader && <th className="px-2 py-2 font-medium">{primaryHeader}</th>}
                      <th className="px-2 py-2 font-medium">{columns.company}</th>
                      <th className="px-2 py-2 font-medium">{columns.persons ?? 'Hinweise'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData?.rows.map((row) => {
                      const notImported = row.status === 'excluded' || row.status === 'skipped'
                      return (
                        <tr
                          key={row.rowNumber}
                          className={cn(
                            'border-t align-top',
                            notImported && 'text-muted-foreground'
                          )}
                        >
                          <td className="px-3 py-2">
                            {(row.status === 'record' || row.status === 'excluded') && (
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
                            <td
                              colSpan={primaryHeader ? 2 : 1}
                              className="px-2 py-2 text-muted-foreground"
                            >
                              {columns.continuation}
                            </td>
                          ) : (
                            <>
                              {primaryHeader && (
                                <td className="px-2 py-2">
                                  <EntityCell entity={row.primary} struck={notImported} />
                                </td>
                              )}
                              <td className="px-2 py-2">
                                <EntityCell entity={row.company} struck={notImported} />
                              </td>
                            </>
                          )}
                          <td className="px-2 py-2">
                            <div className="flex flex-col gap-1">
                              {columns.persons && row.persons.length === 0 && !notImported && (
                                <span className="text-muted-foreground">–</span>
                              )}
                              {row.persons.map((person, index) => (
                                <EntityCell key={index} entity={person} struck={notImported} />
                              ))}
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
              {summaryEntities(target, kind).map(([entity, label]) => (
                <p key={entity}>
                  <strong>{result[entity].created}</strong>{' '}
                  {result[entity].created === 1 ? (SINGULAR[label] ?? label) : label} angelegt,{' '}
                  <strong>{result[entity].updated}</strong> ergänzt
                </p>
              ))}
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
