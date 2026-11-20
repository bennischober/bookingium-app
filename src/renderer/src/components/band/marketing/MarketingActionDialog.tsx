import { useState } from 'react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { formatMoney, parseAmount } from '@/lib/invoiceLabels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import { fromCents, toCents } from '../../../../../main/einvoice/amounts'
import {
  MARKETING_ACTION_KIND_LABELS,
  MARKETING_ACTION_STATUS_LABELS,
  MARKETING_PAYER_LABELS,
  MarketingActionKind,
  MarketingActionStatus,
  MarketingPayer,
  type MarketingActionDto,
  type MarketingActionFields
} from '../../../../../main/api/schemas/marketing.schema'
import { t } from '../../../../../main/i18n/translate'

/** What a new measure starts with (from an atlas entry or an event page) */
export type MarketingActionPreset = Partial<
  Pick<
    MarketingActionFields,
    'kind' | 'title' | 'companyId' | 'marketingItemId' | 'dealMemoId' | 'tour'
  >
>

type Draft = {
  kind: MarketingActionKind
  title: string
  status: MarketingActionStatus
  dealMemoId: number | null
  tour: string
  release: string
  companyId: number | null
  marketingItemId: number | null
  startDate: string
  endDate: string
  region: string
  cost: string
  payer: MarketingPayer
  receiptId: number | null
  notes: string
}

function draftOf(action: MarketingActionDto | null, preset: MarketingActionPreset): Draft {
  return {
    kind: action?.kind ?? preset.kind ?? 'radio_spot',
    title: action?.title ?? preset.title ?? '',
    status: action?.status ?? 'planned',
    dealMemoId: action?.dealMemoId ?? preset.dealMemoId ?? null,
    tour: action?.tour ?? preset.tour ?? '',
    release: action?.release ?? '',
    companyId: action?.companyId ?? preset.companyId ?? null,
    marketingItemId: action?.marketingItemId ?? preset.marketingItemId ?? null,
    startDate: action?.startDate ?? '',
    endDate: action?.endDate ?? '',
    region: action?.region ?? '',
    cost:
      action?.costCents != null
        ? fromCents(action.costCents).toLocaleString('de-DE', { minimumFractionDigits: 2 })
        : '',
    payer: action?.payer ?? 'us',
    receiptId: action?.receiptId ?? null,
    notes: action?.notes ?? ''
  }
}

/** Create or edit a measure (Maßnahme) of a band */
export function MarketingActionDialog({
  bandId,
  action,
  preset = {},
  open,
  onOpenChange
}: {
  bandId: number
  /** null: a new measure */
  action: MarketingActionDto | null
  preset?: MarketingActionPreset
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const utils = trpcReact.useUtils()
  const [draft, setDraft] = useState<Draft>(() => draftOf(action, preset))
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))
  const events = trpcReact.dealMemo.listByBand.useQuery(bandId, { enabled: open })
  const companies = trpcReact.company.getListItems.useQuery(undefined, { enabled: open })
  const tours = trpcReact.tourImport.tours.useQuery(undefined, { enabled: open })
  const atlas = trpcReact.marketing.overview.useQuery(bandId, { enabled: open })
  const receipts = trpcReact.receipt.list.useQuery({ page: 1, pageSize: 200 }, { enabled: open })

  const done = async (message: string) => {
    await utils.marketing.invalidate()
    toast.success(message)
    onOpenChange(false)
  }
  const create = trpcReact.marketing.createAction.useMutation({
    onSuccess: () => done(t('Maßnahme angelegt')),
    onError: (error) => toast.error(t('Nicht gespeichert'), { description: error.message })
  })
  const update = trpcReact.marketing.updateAction.useMutation({
    onSuccess: () => done(t('Maßnahme gespeichert')),
    onError: (error) => toast.error(t('Nicht gespeichert'), { description: error.message })
  })

  const save = () => {
    let costCents: number | null = null
    if (draft.cost.trim()) {
      const amount = parseAmount(draft.cost)
      if (amount === null || amount < 0) {
        toast.error(t('Die Kosten sind keine Zahl'))
        return
      }
      costCents = toCents(amount)
    }
    if (!draft.title.trim()) {
      toast.error(t('Bitte eine Bezeichnung angeben'))
      return
    }
    const fields = {
      bandId,
      kind: draft.kind,
      title: draft.title,
      status: draft.status,
      dealMemoId: draft.dealMemoId,
      tour: draft.tour,
      release: draft.release,
      companyId: draft.companyId,
      marketingItemId: draft.marketingItemId,
      startDate: draft.startDate || null,
      endDate: draft.endDate || null,
      region: draft.region,
      costCents,
      payer: draft.payer,
      receiptId: draft.receiptId,
      notes: draft.notes
    }
    if (action) update.mutate({ id: action.id, ...fields })
    else create.mutate(fields)
  }

  const showOptions = (events.data ?? []).map((event) => ({
    value: event.id,
    label: [event.date.split('-').reverse().join('.'), event.name, event.venueName]
      .filter(Boolean)
      .join(' · ')
  }))
  const receiptOptions = (receipts.data?.items ?? []).map((receipt) => ({
    value: receipt.id,
    label: receipt.fileName,
    hint: [
      receipt.supplierName,
      receipt.amountCents != null && formatMoney(fromCents(receipt.amountCents), receipt.currency)
    ]
      .filter(Boolean)
      .join(' · ')
  }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{action ? t('Maßnahme bearbeiten') : t('Neue Maßnahme')}</DialogTitle>
          <DialogDescription>
            {t('Radiospot, Plakat, Anzeige … für eine Show, eine Tour oder ein Release.')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="action-kind">{t('Art')}</Label>
            <Select
              value={draft.kind}
              onValueChange={(kind) => set({ kind: kind as MarketingActionKind })}
            >
              <SelectTrigger id="action-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MarketingActionKind.options.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {MARKETING_ACTION_KIND_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="action-status">{t('Status')}</Label>
            <Select
              value={draft.status}
              onValueChange={(status) => set({ status: status as MarketingActionStatus })}
            >
              <SelectTrigger id="action-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MarketingActionStatus.options.map((status) => (
                  <SelectItem key={status} value={status}>
                    {MARKETING_ACTION_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="action-title">{t('Bezeichnung')}</Label>
            <Input
              id="action-title"
              placeholder={t('z. B. Spot 20 s, Tourvorbericht')}
              value={draft.title}
              onChange={(event) => set({ title: event.target.value })}
            />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="action-show">{t('Show')}</Label>
            <SearchableSelect
              id="action-show"
              value={draft.dealMemoId}
              onChange={(dealMemoId) => {
                const show = events.data?.find((event) => event.id === dealMemoId)
                set({ dealMemoId, tour: draft.tour || show?.tour || '' })
              }}
              options={showOptions}
              noneLabel={t('Keine bestimmte Show')}
              searchPlaceholder={t('Show suchen…')}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="action-tour">{t('Tour')}</Label>
            <Input
              id="action-tour"
              list="action-tours"
              value={draft.tour}
              onChange={(event) => set({ tour: event.target.value })}
            />
            <datalist id="action-tours">
              {(tours.data ?? []).map((tour) => (
                <option key={tour} value={tour} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1">
            <Label htmlFor="action-release">{t('Release')}</Label>
            <Input
              id="action-release"
              placeholder={t('z. B. neues Album')}
              value={draft.release}
              onChange={(event) => set({ release: event.target.value })}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="action-company">{t('Partner')}</Label>
            <SearchableSelect
              id="action-company"
              value={draft.companyId}
              onChange={(companyId) => set({ companyId })}
              options={(companies.data ?? []).map((company) => ({
                value: company.id,
                label: company.name
              }))}
              noneLabel={t('Kein Partner')}
              searchPlaceholder={t('Sender, Magazin, Firma…')}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="action-item">{t('Aus dem Atlas')}</Label>
            <SearchableSelect
              id="action-item"
              value={draft.marketingItemId}
              onChange={(marketingItemId) => set({ marketingItemId })}
              options={(atlas.data?.items ?? []).map((item) => ({
                value: item.id,
                label: item.name,
                hint: t('Priorität {{priority}}', { priority: item.priority })
              }))}
              noneLabel={t('Nicht aus dem Atlas')}
              searchPlaceholder={t('Atlas-Eintrag suchen…')}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="action-start">{t('Von')}</Label>
            <Input
              id="action-start"
              type="date"
              value={draft.startDate}
              onChange={(event) => set({ startDate: event.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="action-end">{t('Bis')}</Label>
            <Input
              id="action-end"
              type="date"
              value={draft.endDate}
              onChange={(event) => set({ endDate: event.target.value })}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="action-region">{t('Region / Ort')}</Label>
            <Input
              id="action-region"
              placeholder={t('z. B. Rhein-Main, Leipzig')}
              value={draft.region}
              onChange={(event) => set({ region: event.target.value })}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="action-cost">{t('Kosten netto (€)')}</Label>
            <Input
              id="action-cost"
              inputMode="decimal"
              placeholder="z. B. 1.200,00"
              value={draft.cost}
              onChange={(event) => set({ cost: event.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="action-payer">{t('Zahlt')}</Label>
            <Select
              value={draft.payer}
              onValueChange={(payer) => set({ payer: payer as MarketingPayer })}
            >
              <SelectTrigger id="action-payer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MarketingPayer.options.map((payer) => (
                  <SelectItem key={payer} value={payer}>
                    {MARKETING_PAYER_LABELS[payer]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="action-receipt">{t('Beleg')}</Label>
            <SearchableSelect
              id="action-receipt"
              value={draft.receiptId}
              onChange={(receiptId) => set({ receiptId })}
              options={receiptOptions}
              noneLabel={t('Kein Beleg')}
              searchPlaceholder={t('Beleg suchen…')}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="action-notes">{t('Notiz')}</Label>
            <Textarea
              id="action-notes"
              rows={2}
              value={draft.notes}
              onChange={(event) => set({ notes: event.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Abbrechen')}
          </Button>
          <Button disabled={create.isPending || update.isPending} onClick={save}>
            {action ? t('Speichern') : t('Anlegen')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
