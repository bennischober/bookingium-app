import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, FileUp } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { keepOpenOnToast } from '@/lib/utils'
import { formatMoney } from '@/lib/invoiceLabels'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { FieldShell } from '@/components/forms/FormFields'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  LABEL_COPY_SOURCE_LABELS,
  type ImportStatus,
  type LabelCopyOrigin,
  type LabelCopyPlanDto,
  type RowPlan
} from '../../../../main/api/schemas/release_import.schema'
import { MARKETING_ACTION_KIND_LABELS } from '../../../../main/api/schemas/marketing.schema'
import { fromCents } from '../../../../main/einvoice/amounts'
import { importSummary, NEW_RELEASE, statusLabel } from './labelCopyImport'
import { releaseTitle } from './releaseText'
import { t } from '../../../../main/i18n/translate'

const STATUS_CLASS: Record<ImportStatus, string> = {
  new: 'border-emerald-500/50 text-emerald-700 dark:text-emerald-400',
  fill: 'border-sky-500/50 text-sky-700 dark:text-sky-400',
  conflict: 'border-amber-500/50 text-amber-700 dark:text-amber-400',
  same: 'text-muted-foreground'
}

function StatusBadge({ status }: { status: ImportStatus }) {
  return (
    <Badge variant="outline" className={STATUS_CLASS[status]}>
      {statusLabel(status)}
    </Badge>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function Rows({ rows }: { rows: RowPlan[] }) {
  const [showSame, setShowSame] = useState(false)
  const unchanged = rows.filter((row) => row.status === 'same')
  const shown = showSame ? rows : rows.filter((row) => row.status !== 'same')
  return (
    <div className="space-y-1.5">
      {shown.length > 0 && (
        <ul className="divide-y rounded-md border">
          {shown.map((row) => (
            <li key={row.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-1.5">
              <StatusBadge status={row.status} />
              <span className="font-medium">{row.label}</span>
              {row.detail && <span className="text-muted-foreground">{row.detail}</span>}
              {row.conflicts.length > 0 && (
                <span className="w-full text-xs text-amber-700 dark:text-amber-400">
                  {t('weicht ab: {{fields}}', { fields: row.conflicts.join(', ') })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {unchanged.length > 0 && (
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setShowSame((value) => !value)}
        >
          {showSame
            ? t('Unveränderte ausblenden')
            : t('{{count}} unverändert', { count: unchanged.length })}
        </button>
      )}
    </div>
  )
}

/**
 * #289: the preview of a label copy before it lands in a release: the release it goes into
 * (found by its codes, picked, or new), what is new, what fills gaps, what differs, the
 * label's budget lines as measures.
 */
export function LabelCopyImportDialog({
  source,
  initialPlan,
  defaultBandId = null,
  openRelease = true,
  onClose
}: {
  /** The picked file or the mail attachment, read again by main for each step */
  source: LabelCopyOrigin
  initialPlan: LabelCopyPlanDto
  /** A band page starts a new release with its band */
  defaultBandId?: number | null
  /** Opens the release afterwards; false where that would leave the work (a mail) */
  openRelease?: boolean
  onClose: () => void
}) {
  const navigate = useNavigate()
  const utils = trpcReact.useUtils()
  const [plan, setPlan] = useState(initialPlan)
  const [bandId, setBandId] = useState<number | null>(initialPlan.suggestedBandId ?? defaultBandId)
  const [takeFields, setTakeFields] = useState<string[]>([])
  const [overwrite, setOverwrite] = useState(false)
  const [budget, setBudget] = useState<number[]>([])

  const releases = trpcReact.release.listAll.useQuery()
  const bands = trpcReact.band.getListItems.useQuery()
  const replan = trpcReact.release.planLabelCopy.useMutation({
    onSuccess: (next) => {
      setPlan(next)
      setTakeFields([])
      setBudget([])
    },
    onError: (error) => toast.error(t('Labelcopy nicht gelesen'), { description: error.message })
  })
  const apply = trpcReact.release.applyLabelCopy.useMutation({
    onSuccess: (result) => {
      void utils.release.invalidate()
      void utils.marketing.invalidate()
      void utils.document.invalidate()
      toast.success(t('Labelcopy übernommen'), { description: importSummary(result) })
      onClose()
      if (openRelease)
        void navigate({
          to: '/releases/$releaseId',
          params: { releaseId: String(result.releaseId) }
        })
    },
    onError: (error) => toast.error(t('Labelcopy nicht übernommen'), { description: error.message })
  })

  const targetOptions = useMemo(
    () => [
      { value: NEW_RELEASE, label: t('Neues Release anlegen') },
      ...(releases.data ?? []).map((release) => ({
        value: release.id,
        label: releaseTitle(release),
        hint: [release.artist, release.catalogNumber].filter(Boolean).join(' · ')
      }))
    ],
    [releases.data]
  )
  const bandOptions = (bands.data ?? []).map((band) => ({ value: band.id, label: band.name }))
  const isNew = plan.releaseId === null
  const conflicts = plan.head.filter((field) => field.status === 'conflict')
  const rowConflicts = [...plan.tracks, ...plan.products].some((row) => row.status === 'conflict')
  const budgetPossible = isNew ? bandId !== null : plan.canImportBudget
  const headShown = plan.head.filter((field) => field.status !== 'same')
  const busy = replan.isPending || apply.isPending

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[90vh] max-w-3xl overflow-y-auto"
        onInteractOutside={keepOpenOnToast}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" />
            {t('Labelcopy übernehmen')}
          </DialogTitle>
          <DialogDescription>
            {plan.fileName} · {LABEL_COPY_SOURCE_LABELS[plan.source]}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldShell
              id="label-copy-target"
              label={t('Übernehmen in')}
              hint={
                plan.matchedBy
                  ? t('Gefunden über {{value}}.', { value: plan.matchedBy })
                  : isNew
                    ? t('Kein Release mit diesen Codes gefunden.')
                    : undefined
              }
            >
              <SearchableSelect
                id="label-copy-target"
                value={plan.releaseId ?? NEW_RELEASE}
                onChange={(value) =>
                  replan.mutate({
                    source,
                    releaseId: value === null || value === NEW_RELEASE ? null : value
                  })
                }
                options={targetOptions}
                searchPlaceholder={t('Release suchen…')}
                emptyText={t('Kein Release gefunden.')}
                disabled={busy}
              />
            </FieldShell>
            {isNew && (
              <FieldShell id="label-copy-band" label={t('Band')}>
                <SearchableSelect
                  id="label-copy-band"
                  value={bandId}
                  onChange={setBandId}
                  options={bandOptions}
                  noneLabel={t('Keine eigene Band')}
                  placeholder={t('Band auswählen')}
                  searchPlaceholder={t('Band suchen…')}
                  emptyText={t('Keine Band gefunden.')}
                  disabled={busy}
                />
              </FieldShell>
            )}
          </div>

          {plan.warnings.length > 0 && (
            <ul className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              {plan.warnings.map((warning) => (
                <li key={warning} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  {warning}
                </li>
              ))}
            </ul>
          )}

          {headShown.length > 0 && (
            <Section title={t('Kopfdaten')}>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full" aria-label={t('Kopfdaten')}>
                  <thead className="bg-muted text-left">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">{t('Feld')}</th>
                      {!isNew && <th className="px-3 py-1.5 font-medium">{t('Jetzt')}</th>}
                      <th className="px-3 py-1.5 font-medium">{t('Aus der Datei')}</th>
                      <th className="px-3 py-1.5 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {headShown.map((field) => (
                      <tr key={field.field} className="border-t align-top">
                        <td className="px-3 py-1.5 text-muted-foreground">{field.label}</td>
                        {!isNew && <td className="px-3 py-1.5">{field.current || '-'}</td>}
                        <td className="px-3 py-1.5">{field.incoming}</td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap">
                          {field.status === 'conflict' ? (
                            <label className="inline-flex items-center gap-2">
                              <Switch
                                checked={takeFields.includes(field.field)}
                                onCheckedChange={(on) =>
                                  setTakeFields((current) =>
                                    on
                                      ? [...current, field.field]
                                      : current.filter((f) => f !== field.field)
                                  )
                                }
                                aria-label={t('{{label}} aus der Datei übernehmen', {
                                  label: field.label
                                })}
                              />
                              {t('übernehmen')}
                            </label>
                          ) : (
                            <StatusBadge status={field.status} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {conflicts.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t(
                    'Abweichende Angaben bleiben, wie sie sind, bis du sie zum Übernehmen markierst.'
                  )}
                </p>
              )}
            </Section>
          )}

          <Section title={t('Tracks ({{count}})', { count: plan.tracks.length })}>
            <Rows rows={plan.tracks} />
          </Section>

          <Section title={t('Produkte ({{count}})', { count: plan.products.length })}>
            <Rows rows={plan.products} />
          </Section>

          {rowConflicts && (
            <label className="flex items-start gap-3 rounded-md border p-3">
              <Switch checked={overwrite} onCheckedChange={setOverwrite} className="mt-0.5" />
              <span>
                {t('Abweichende Angaben bei Tracks und Produkten aus der Datei übernehmen')}
                <span className="block text-xs text-muted-foreground">
                  {t(
                    'Sonst werden dort nur leere Felder ergänzt; Mitwirkende, Urheber und Tracklisten bleiben, wie sie sind.'
                  )}
                </span>
              </span>
            </label>
          )}

          {plan.credits.incoming > 0 && (
            <p className="text-muted-foreground">
              {t('Credits: {{count}} in der Datei, davon {{added}} neu.', {
                count: plan.credits.incoming,
                added: plan.credits.added
              })}
            </p>
          )}

          {plan.budget.length > 0 && (
            <Section title={t('Budget als Marketing-Maßnahmen')}>
              <p className="text-xs text-muted-foreground">
                {budgetPossible
                  ? t(
                      'Was aus der Labelcopy kommt, bezahlt das Label: die Maßnahmen bekommen „Zahlt: Label“ und das Label als Partner.'
                    )
                  : t('Maßnahmen brauchen eine Band. Wähle oben die Band des Releases.')}
              </p>
              <ul className="divide-y rounded-md border">
                {plan.budget.map((line) => (
                  <li key={line.index} className="flex items-center gap-3 px-3 py-1.5">
                    <Switch
                      checked={budget.includes(line.index)}
                      disabled={!budgetPossible || line.exists}
                      onCheckedChange={(on) =>
                        setBudget((current) =>
                          on ? [...current, line.index] : current.filter((i) => i !== line.index)
                        )
                      }
                      aria-label={t('{{title}} als Maßnahme anlegen', { title: line.title })}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{line.title}</span>
                      <span className="ml-2 text-muted-foreground">
                        {[
                          MARKETING_ACTION_KIND_LABELS[line.kind],
                          line.costCents !== null && formatMoney(fromCents(line.costCents), 'EUR'),
                          line.done && t('erledigt'),
                          line.exists && t('schon angelegt')
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Abbrechen')}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              apply.mutate({
                source,
                releaseId: plan.releaseId,
                bandId: isNew ? bandId : null,
                takeFields,
                overwrite,
                budget: budgetPossible ? budget : []
              })
            }
          >
            {isNew ? t('Release anlegen') : t('Übernehmen')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
