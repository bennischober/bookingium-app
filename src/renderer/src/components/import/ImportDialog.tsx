import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
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
import {
  IMPORT_TARGET_DESCRIPTIONS,
  MULTI_COLUMN_FIELDS,
  type ImportTarget,
  type ImportField,
  type ImportRequest,
  type ImportResult,
  type ImportFile
} from '../../../../main/api/schemas/import.schema'
import type { VenueKind } from '../../../../main/api/schemas/venue.schema'
import type { CompanyKind } from '../../../../main/api/schemas/company.schema'
import { ImportFileStep } from './ImportFileStep'
import { ImportMappingStep } from './ImportMappingStep'
import { ImportPreviewStep } from './ImportPreviewStep'
import { ImportDoneStep } from './ImportDoneStep'

type Step = 'file' | 'mapping' | 'preview' | 'done'

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What the list holds when opened from a list page (else detected) */
  target?: ImportTarget
  /** Clubs or festivals, when opened from one of those lists (else detected); still changeable */
  kind?: VenueKind
}

/**
 * Imports a list from a CSV file: pick the file, choose what the list
 * holds (venues, bands, companies, persons) and check the column mapping,
 * review every row, import. Existing records (same name) only get their
 * empty fields filled. The mapping is remembered for lists with the same
 * columns.
 */
export function ImportDialog({
  open,
  onOpenChange,
  target: fixedTarget,
  kind: fixedKind
}: ImportDialogProps) {
  const utils = trpcReact.useUtils()
  const [step, setStep] = useState<Step>('file')
  const [picking, setPicking] = useState(false)
  const [file, setFile] = useState<ImportFile | null>(null)
  const [target, setTarget] = useState<ImportTarget>(fixedTarget ?? 'venues')
  const [mapping, setMapping] = useState<ImportField[]>([])
  const [kind, setKind] = useState<VenueKind>(fixedKind ?? 'venue')
  const [companyKind, setCompanyKind] = useState<CompanyKind>('company')
  const [genres, setGenres] = useState('')
  const [defaultCountry, setDefaultCountry] = useState('')
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const [result, setResult] = useState<ImportResult | null>(null)
  // #154: the records that take an address of the file go into a member list
  const [saveAsList, setSaveAsList] = useState(false)
  // 'new' or the id of an existing member list
  const [listTarget, setListTarget] = useState('new')
  const [listName, setListName] = useState('')

  const table = file?.table ?? null

  const reset = (): void => {
    setStep('file')
    setFile(null)
    setResult(null)
    setExcluded(new Set())
  }

  const close = (): void => {
    onOpenChange(false)
    reset()
  }

  const selectTable = (next: NonNullable<ImportFile['table']>): void => {
    const nextTarget = fixedTarget ?? next.suggestedTarget
    setTarget(nextTarget)
    setMapping(next.suggestedMappings[nextTarget])
    setKind(fixedKind ?? next.suggestedKind)
    setCompanyKind(next.suggestedCompanyKind)
    setGenres('')
    setDefaultCountry(next.suggestedCountry)
    setExcluded(new Set())
    setSaveAsList(false)
    setListTarget('new')
    setListName(next.name)
  }

  const selectTarget = (next: ImportTarget): void => {
    setTarget(next)
    if (table) setMapping(table.suggestedMappings[next])
    setExcluded(new Set())
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
      if (!response.file.table) {
        toast.error('Keine Daten gefunden', {
          description: 'Die Datei enthält keine Kopfzeile mit Datenzeilen darunter.'
        })
        return
      }
      setFile(response.file)
      selectTable(response.file.table)
      setStep('mapping')
    } finally {
      setPicking(false)
    }
  }

  const request: ImportRequest | null = table
    ? {
        target,
        headers: table.headers,
        rows: table.rows,
        mapping,
        options: { kind, companyKind, genres, defaultCountry },
        excludedRows: [...excluded],
        // Set on commit only: the preview does not depend on it
        contactList: null
      }
    : null

  const savedLists = trpcReact.contactList.listSaved.useQuery(undefined, {
    enabled: open && step === 'preview'
  })
  const memberLists = (savedLists.data ?? []).filter((entry) => entry.kind === 'members')
  const listMissingName = saveAsList && listTarget === 'new' && !listName.trim()

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
      void utils.contactList.invalidate()
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
              'Eine CSV-Liste mit Clubs, Festivals, Bands, Firmen oder Personen übernehmen.'}
            {step === 'mapping' && IMPORT_TARGET_DESCRIPTIONS[target]}
            {step === 'preview' &&
              'Vorhandene Einträge (gleicher Name) werden nur ergänzt, nie überschrieben. Zeilen abwählen, um sie auszulassen.'}
            {step === 'done' && 'Der Import ist abgeschlossen.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'file' && <ImportFileStep picking={picking} onPick={pickFile} />}

        {step === 'mapping' && file && table && (
          <ImportMappingStep
            file={file}
            table={table}
            target={target}
            onTargetChange={selectTarget}
            kind={kind}
            onKindChange={setKind}
            companyKind={companyKind}
            onCompanyKindChange={setCompanyKind}
            genres={genres}
            onGenresChange={setGenres}
            defaultCountry={defaultCountry}
            onDefaultCountryChange={setDefaultCountry}
            mapping={mapping}
            onColumnFieldChange={setColumnField}
          />
        )}

        {step === 'preview' && (
          <ImportPreviewStep
            target={target}
            kind={kind}
            companyKind={companyKind}
            previewData={previewData}
            loading={preview.isLoading}
            errorMessage={preview.isError ? preview.error.message : null}
            excluded={excluded}
            onToggleRow={toggleRow}
            saveAsList={saveAsList}
            onSaveAsListChange={setSaveAsList}
            listTarget={listTarget}
            onListTargetChange={setListTarget}
            listName={listName}
            onListNameChange={setListName}
            memberLists={memberLists}
          />
        )}

        {step === 'done' && result && (
          <ImportDoneStep target={target} kind={kind} companyKind={companyKind} result={result} />
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
                onClick={() =>
                  request &&
                  commit.mutate({
                    ...request,
                    contactList: saveAsList
                      ? {
                          id: listTarget === 'new' ? null : Number(listTarget),
                          name: listName.trim()
                        }
                      : null
                  })
                }
                disabled={
                  !previewData ||
                  listMissingName ||
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
