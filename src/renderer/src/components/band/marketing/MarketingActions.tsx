import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { FileText, Pencil, Plus, Receipt, Trash2 } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { confirmDelete } from '@/lib/confirm'
import { cn } from '@/lib/utils'
import { formatMoney, invoiceNumberLabel } from '@/lib/invoiceLabels'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SearchableSelect } from '@/components/ui/searchable-select'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { fromCents } from '../../../../../main/einvoice/amounts'
import {
  MARKETING_ACTION_KIND_LABELS,
  MARKETING_ACTION_STATUS_LABELS,
  MARKETING_PAYER_LABELS,
  MarketingActionStatus,
  type MarketingActionDto,
  type MarketingActionScope
} from '../../../../../main/api/schemas/marketing.schema'
import { MarketingActionDialog, type MarketingActionPreset } from './MarketingActionDialog'
import { totalCents } from './marketingFilters'

const ALL = 'all'

const STATUS_STYLES: Record<MarketingActionStatus, string> = {
  planned: 'border-l-muted-foreground/40',
  booked: 'border-l-amber-500',
  running: 'border-l-green-600',
  done: 'border-l-primary',
  cancelled: 'border-l-transparent opacity-60'
}

const germanDate = (iso: string): string => iso.split('-').reverse().join('.')

function period(action: MarketingActionDto): string {
  if (action.startDate && action.endDate && action.startDate !== action.endDate)
    return `${germanDate(action.startDate)} – ${germanDate(action.endDate)}`
  if (action.startDate) return germanDate(action.startDate)
  return action.endDate ? `bis ${germanDate(action.endDate)}` : ''
}

/** The measures of a band, a show or a partner, with "Neue Maßnahme" */
export function MarketingActions({
  scope,
  bandId,
  preset = {},
  showBand = false,
  compact = false
}: {
  scope: MarketingActionScope
  /** The band new measures belong to; none on a company page */
  bandId: number | null
  preset?: MarketingActionPreset
  /** Company page: which band each measure is for */
  showBand?: boolean
  /** Event and company pages: no filters, no grouping */
  compact?: boolean
}) {
  const actions = trpcReact.marketing.actions.useQuery(scope)
  const [status, setStatus] = useState<MarketingActionStatus | null>(null)
  const [editing, setEditing] = useState<MarketingActionDto | 'new' | null>(null)
  const [billing, setBilling] = useState<MarketingActionDto | null>(null)

  const shown = useMemo(
    () => (actions.data ?? []).filter((action) => !status || action.status === status),
    [actions.data, status]
  )
  const groups = useMemo(() => {
    if (compact) return [['', shown]] as Array<[string, MarketingActionDto[]]>
    const byTour = new Map<string, MarketingActionDto[]>()
    for (const action of shown) {
      const key = action.tour
        ? `Tour ${action.tour}`
        : action.release
          ? `Release ${action.release}`
          : 'Ohne Tour'
      byTour.set(key, [...(byTour.get(key) ?? []), action])
    }
    return [...byTour.entries()]
  }, [shown, compact])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {bandId !== null && (
          <Button size="sm" className="gap-1.5" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" />
            Neue Maßnahme
          </Button>
        )}
        {!compact && (
          <Select
            value={status ?? ALL}
            onValueChange={(value) =>
              setStatus(value === ALL ? null : (value as MarketingActionStatus))
            }
          >
            <SelectTrigger className="h-9 w-44" aria-label="Status der Maßnahmen filtern">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Jeder Status</SelectItem>
              {MarketingActionStatus.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {MARKETING_ACTION_STATUS_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {shown.length > 0 && (
          <span className="ml-auto text-sm text-muted-foreground">
            {shown.length} {shown.length === 1 ? 'Maßnahme' : 'Maßnahmen'} · Kosten{' '}
            {formatMoney(fromCents(totalCents(shown)), 'EUR')} netto
          </span>
        )}
      </div>

      {actions.isLoading ? (
        <p className="text-sm text-muted-foreground">Wird geladen…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {status ? 'Keine Maßnahmen mit diesem Status.' : 'Noch keine Maßnahmen.'}
        </p>
      ) : (
        groups.map(([group, entries]) => (
          <section key={group} className="space-y-1">
            {group && (
              <h3 className="text-sm font-semibold text-muted-foreground">
                {group}{' '}
                <span className="font-normal">
                  ({entries.length} · {formatMoney(fromCents(totalCents(entries)), 'EUR')})
                </span>
              </h3>
            )}
            <ul className="border-t">
              {entries.map((action) => (
                <ActionRow
                  key={action.id}
                  action={action}
                  showBand={showBand}
                  onEdit={() => setEditing(action)}
                  onBill={() => setBilling(action)}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {editing !== null && (
        <MarketingActionDialog
          bandId={editing === 'new' ? (bandId as number) : editing.bandId}
          action={editing === 'new' ? null : editing}
          preset={preset}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}
      {billing && <InvoiceDialog action={billing} onClose={() => setBilling(null)} />}
    </div>
  )
}

function ActionRow({
  action,
  showBand,
  onEdit,
  onBill
}: {
  action: MarketingActionDto
  showBand: boolean
  onEdit: () => void
  onBill: () => void
}) {
  const utils = trpcReact.useUtils()
  const remove = trpcReact.marketing.deleteAction.useMutation({
    onSuccess: () => utils.marketing.invalidate(),
    onError: (error) => toast.error('Nicht gelöscht', { description: error.message })
  })
  const when = period(action)
  return (
    <li className={cn('border-b border-l-4 px-3 py-2.5', STATUS_STYLES[action.status])}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="font-medium">
            <span className="mr-2 text-xs font-normal uppercase tracking-wide text-muted-foreground">
              {MARKETING_ACTION_KIND_LABELS[action.kind]}
            </span>
            {action.title}
          </p>
          <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
            {showBand && (
              <Link
                to="/band/$bandId"
                params={{ bandId: String(action.bandId) }}
                search={{ tab: 'marketing' }}
                className="hover:underline"
              >
                {action.bandName}
              </Link>
            )}
            {action.showLabel && action.dealMemoId !== null && (
              <Link
                to="/events/$eventId"
                params={{ eventId: String(action.dealMemoId) }}
                className="hover:underline"
              >
                {action.showLabel}
              </Link>
            )}
            {!action.showLabel && action.tour && <span>Tour {action.tour}</span>}
            {action.release && <span>Release {action.release}</span>}
            {action.companyName && action.companyId !== null && (
              <Link
                to="/companies/$companyId"
                params={{ companyId: String(action.companyId) }}
                className="hover:underline"
              >
                {action.companyName}
              </Link>
            )}
            {when && <span>{when}</span>}
            {action.region && <span>{action.region}</span>}
          </p>
          {action.marketingItemName && (
            <p className="text-xs text-muted-foreground">
              Aus dem Atlas: {action.marketingItemName}
            </p>
          )}
          {action.notes && <p className="text-sm text-muted-foreground">{action.notes}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-sm">
          <Badge variant="outline">{MARKETING_ACTION_STATUS_LABELS[action.status]}</Badge>
          {action.costCents !== null && (
            <span>
              {formatMoney(fromCents(action.costCents), 'EUR')}
              <span className="text-muted-foreground">
                {' '}
                · zahlt {MARKETING_PAYER_LABELS[action.payer]}
              </span>
            </span>
          )}
          {action.receiptName && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Receipt className="h-3.5 w-3.5" /> {action.receiptName}
            </span>
          )}
          {action.invoiceId !== null && (
            <Link
              to="/invoices/$invoiceId"
              params={{ invoiceId: String(action.invoiceId) }}
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <FileText className="h-3.5 w-3.5" />
              {action.invoiceNumber !== null
                ? `Rechnung ${invoiceNumberLabel(action.invoiceNumber)}`
                : 'Rechnungsentwurf'}
            </Link>
          )}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" /> Bearbeiten
        </Button>
        {action.invoiceId === null && action.costCents !== null && action.costCents > 0 && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onBill}>
            <FileText className="h-3.5 w-3.5" /> Rechnung erstellen…
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
          disabled={remove.isPending}
          onClick={async () => {
            if (await confirmDelete(`„${action.title}“ löschen?`)) remove.mutate(action.id)
          }}
        >
          <Trash2 className="h-3.5 w-3.5" /> Löschen
        </Button>
      </div>
    </li>
  )
}

/** "Rechnung erstellen": to the band or a company; opens the draft afterwards */
function InvoiceDialog({ action, onClose }: { action: MarketingActionDto; onClose: () => void }) {
  const navigate = useNavigate()
  const utils = trpcReact.useUtils()
  const [recipient, setRecipient] = useState<'band' | 'company'>('band')
  const [companyId, setCompanyId] = useState<number | null>(action.companyId)
  const companies = trpcReact.company.getListItems.useQuery()
  const create = trpcReact.marketing.createActionInvoice.useMutation({
    onSuccess: async ({ invoiceId }) => {
      await utils.invalidate()
      toast.success('Rechnungsentwurf angelegt')
      onClose()
      void navigate({ to: '/invoices', search: { open: invoiceId } })
    },
    onError: (error) =>
      toast.error('Rechnung konnte nicht erstellt werden', { description: error.message })
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rechnung erstellen</DialogTitle>
          <DialogDescription>
            Ein Entwurf über{' '}
            {action.costCents !== null && formatMoney(fromCents(action.costCents), 'EUR')} netto
            zzgl. 19 % USt. Er lässt sich danach wie jede Rechnung bearbeiten.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="action-invoice-recipient"
              className="accent-primary"
              checked={recipient === 'band'}
              onChange={() => setRecipient('band')}
            />
            An die Band ({action.bandName})
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="action-invoice-recipient"
              className="accent-primary"
              checked={recipient === 'company'}
              onChange={() => setRecipient('company')}
            />
            An eine Firma (z. B. Label, Veranstalter)
          </label>
          {recipient === 'company' && (
            <SearchableSelect
              id="action-invoice-company"
              value={companyId}
              onChange={setCompanyId}
              options={(companies.data ?? []).map((company) => ({
                value: company.id,
                label: company.name
              }))}
              searchPlaceholder="Firma suchen…"
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            disabled={create.isPending || (recipient === 'company' && companyId === null)}
            onClick={() =>
              create.mutate({
                id: action.id,
                recipient,
                recipientCompanyId: recipient === 'company' ? companyId : null
              })
            }
          >
            Entwurf anlegen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
