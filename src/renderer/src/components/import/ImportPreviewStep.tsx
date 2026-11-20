import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type {
  ImportEntityRef,
  ImportPreview,
  ImportTarget
} from '../../../../main/api/schemas/import.schema'
import { VENUE_KIND_LABELS, type VenueKind } from '../../../../main/api/schemas/venue.schema'
import type { CompanyKind } from '../../../../main/api/schemas/company.schema'
import { PREVIEW_COLUMNS, summaryEntities } from './importLabels'
import { Tip } from '@/components/Tip'
import { t } from '../../../../main/i18n/translate'

const ACTION_LABELS: Record<ImportEntityRef['action'], string> = {
  new: 'neu',
  existing: 'vorhanden',
  repeat: t('wie oben')
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
      {/* #248: what an existing record gets from the file */}
      {entity.action === 'existing' && entity.fills && (
        <span className="text-[11px] text-muted-foreground">
          {entity.fills.length > 0
            ? t('ergänzt: {{fills}}', { fills: entity.fills.join(', ') })
            : t('unverändert')}
        </span>
      )}
    </span>
  )
}

interface ImportPreviewStepProps {
  target: ImportTarget
  kind: VenueKind
  companyKind: CompanyKind
  previewData: ImportPreview | undefined
  loading: boolean
  /** Message of a failed preview, else null */
  errorMessage: string | null
  excluded: Set<number>
  onToggleRow: (rowNumber: number) => void
  saveAsList: boolean
  onSaveAsListChange: (saveAsList: boolean) => void
  /** #248: replace different stored values instead of only filling empty fields */
  overwrite: boolean
  onOverwriteChange: (overwrite: boolean) => void
  /** 'new' or the id of an existing member list */
  listTarget: string
  onListTargetChange: (listTarget: string) => void
  listName: string
  onListNameChange: (listName: string) => void
  memberLists: Array<{ id: number; name: string }>
}

/** Step 3: summary, the member-list option and every row with what it creates */
export function ImportPreviewStep({
  target,
  kind,
  companyKind,
  previewData,
  loading,
  errorMessage,
  excluded,
  onToggleRow,
  saveAsList,
  onSaveAsListChange,
  overwrite,
  onOverwriteChange,
  listTarget,
  onListTargetChange,
  listName,
  onListNameChange,
  memberLists
}: ImportPreviewStepProps) {
  const columns = PREVIEW_COLUMNS[target]
  const primaryHeader = target === 'venues' ? VENUE_KIND_LABELS[kind] : columns.primary

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Tip id="import" />
      {previewData && (
        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
          {summaryEntities(target, kind, companyKind).map(([entity, label]) => (
            <div key={entity} className="rounded-lg border px-3 py-2">
              <div className="text-muted-foreground">{label}</div>
              <div className="font-medium">
                {previewData.summary[entity].new} {t('neu ·')}{' '}
                {previewData.summary[entity].existing} vorhanden
              </div>
            </div>
          ))}
        </div>
      )}

      {previewData && (
        <label className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-primary"
            checked={overwrite}
            onChange={(event) => onOverwriteChange(event.target.checked)}
          />
          <span>
            {t('Vorhandene Angaben überschreiben')}
            <span className="block text-xs text-muted-foreground">
              {overwrite
                ? t(
                    'Werte aus der Datei ersetzen abweichende gespeicherte Werte; Anmerkungen werden angehängt.'
                  )
                : t('Bei vorhandenen Einträgen werden nur leere Felder ergänzt.')}
            </span>
          </span>
        </label>
      )}

      {previewData && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={saveAsList}
              onChange={(event) => onSaveAsListChange(event.target.checked)}
            />
            {t('Als Verteiler speichern')}
          </label>
          {saveAsList && (
            <>
              <Select value={listTarget} onValueChange={onListTargetChange}>
                <SelectTrigger className="h-8 w-56" aria-label={t('Verteiler')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">{t('Neuer Verteiler')}</SelectItem>
                  {memberLists.map((entry) => (
                    <SelectItem key={entry.id} value={String(entry.id)}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {listTarget === 'new' && (
                <Input
                  className="h-8 w-56"
                  aria-label={t('Name des Verteilers')}
                  placeholder={t('Name des Verteilers')}
                  value={listName}
                  onChange={(event) => onListNameChange(event.target.value)}
                />
              )}
              <span className="text-muted-foreground">
                {previewData.listMembers}{' '}
                {previewData.listMembers === 1 ? t('Kontakt kommt') : t('Kontakte kommen')}{' '}
                {t('in den Verteiler (alle mit E-Mail-Adresse in der Datei)')}
              </span>
            </>
          )}
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
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">{t('Vorschau wird berechnet…')}</p>
        ) : errorMessage !== null ? (
          <p className="p-4 text-sm text-destructive">{errorMessage}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-left">
              <tr>
                <th className="w-10 px-3 py-2">
                  <span className="sr-only">{t('Importieren')}</span>
                </th>
                <th className="w-14 px-2 py-2 font-medium">{t('Zeile')}</th>
                {primaryHeader && <th className="px-2 py-2 font-medium">{primaryHeader}</th>}
                <th className="px-2 py-2 font-medium">{columns.company}</th>
                <th className="px-2 py-2 font-medium">{columns.persons ?? t('Hinweise')}</th>
              </tr>
            </thead>
            <tbody>
              {previewData?.rows.map((row) => {
                const notImported = row.status === 'excluded' || row.status === 'skipped'
                return (
                  <tr
                    key={row.rowNumber}
                    className={cn('border-t align-top', notImported && 'text-muted-foreground')}
                  >
                    <td className="px-3 py-2">
                      {(row.status === 'record' || row.status === 'excluded') && (
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={!excluded.has(row.rowNumber)}
                          onChange={() => onToggleRow(row.rowNumber)}
                          aria-label={t('Zeile {{rowNumber}} importieren', {
                            rowNumber: row.rowNumber
                          })}
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
  )
}
