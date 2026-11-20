import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  IMPORT_COUNTRY_OPTIONS,
  IMPORT_TARGET_FIELDS,
  IMPORT_TARGET_LABELS,
  ImportTarget,
  importFieldLabel,
  type ImportField,
  type ImportFile
} from '../../../../main/api/schemas/import.schema'
import { VENUE_KIND_LABELS, VenueKind } from '../../../../main/api/schemas/venue.schema'
import { COMPANY_KIND_LABELS, CompanyKind } from '../../../../main/api/schemas/company.schema'
import { columnLetter } from './importLabels'
import { t } from '../../../../main/i18n/translate'

const NO_COUNTRY = 'none'

interface ImportMappingStepProps {
  file: ImportFile
  table: NonNullable<ImportFile['table']>
  target: ImportTarget
  onTargetChange: (target: ImportTarget) => void
  kind: VenueKind
  onKindChange: (kind: VenueKind) => void
  companyKind: CompanyKind
  onCompanyKindChange: (companyKind: CompanyKind) => void
  genres: string
  onGenresChange: (genres: string) => void
  defaultCountry: string
  onDefaultCountryChange: (country: string) => void
  mapping: ImportField[]
  onColumnFieldChange: (column: number, field: ImportField) => void
}

/** Step 2: what the list holds, the options for all rows and the column mapping */
export function ImportMappingStep({
  file,
  table,
  target,
  onTargetChange,
  kind,
  onKindChange,
  companyKind,
  onCompanyKindChange,
  genres,
  onGenresChange,
  defaultCountry,
  onDefaultCountryChange,
  mapping,
  onColumnFieldChange
}: ImportMappingStepProps) {
  const samples = useMemo(
    () =>
      table.headers.map((_, column) =>
        table.rows
          .map((row) => row.cells[column])
          .filter(Boolean)
          .slice(0, 3)
      ),
    [table]
  )

  const usesAddress = IMPORT_TARGET_FIELDS[target].includes('region')
  // Genre tags of the Verteiler sources the import creates or completes
  const usesGenres =
    target === 'venues' ||
    ((target === 'companies' || target === 'persons') && companyKind === 'media')
  const showRemembered = table.mappingRemembered && table.suggestedTarget === target

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="import-target">{t('Liste enthält')}</Label>
          <Select value={target} onValueChange={(value) => onTargetChange(value as ImportTarget)}>
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
        <div className="min-w-0 space-y-1.5">
          <Label>{t('Datei')}</Label>
          <p className="truncate py-2 text-sm" title={file.fileName}>
            {file.fileName}{' '}
            <span className="text-muted-foreground">
              ({table.rows.length} {table.rows.length === 1 ? t('Zeile') : t('Zeilen')})
            </span>
          </p>
        </div>
        {target === 'venues' && (
          <div className="space-y-1.5">
            <Label htmlFor="import-kind">{t('Importieren als')}</Label>
            <Select value={kind} onValueChange={(value) => onKindChange(value as VenueKind)}>
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
        {(target === 'companies' || target === 'persons') && (
          <div className="space-y-1.5">
            <Label htmlFor="import-company-kind">
              {target === 'companies' ? t('Firmen sind') : t('Firmen der Personen sind')}
            </Label>
            <Select
              value={companyKind}
              onValueChange={(value) => onCompanyKindChange(value as CompanyKind)}
            >
              <SelectTrigger id="import-company-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CompanyKind.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {COMPANY_KIND_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {usesGenres && (
          <div className="space-y-1.5">
            <Label htmlFor="import-genres">{t('Genres für alle')}</Label>
            <Input
              id="import-genres"
              value={genres}
              onChange={(event) => onGenresChange(event.target.value)}
              placeholder={t('z. B. Metal, Rock')}
            />
          </div>
        )}
        {usesAddress && (
          <div className="space-y-1.5">
            <Label htmlFor="import-country">{t('Land, wenn keins angegeben')}</Label>
            <Select
              value={defaultCountry || NO_COUNTRY}
              onValueChange={(value) => onDefaultCountryChange(value === NO_COUNTRY ? '' : value)}
            >
              <SelectTrigger id="import-country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COUNTRY}>{t('Keins')}</SelectItem>
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
          {t('Zuordnung vom letzten Import einer Liste mit diesen Spalten übernommen.')}
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
                className={cn('border-t', mapping[column] === 'ignore' && 'text-muted-foreground')}
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
                    value={mapping[column]}
                    onValueChange={(value) => onColumnFieldChange(column, value as ImportField)}
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
  )
}
