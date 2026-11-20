import { useMemo, useState } from 'react'
import { ExternalLink, FileText, Landmark, Plus, Trash2 } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { useFileDrop } from '@/hooks/useFileDrop'
import { DropOverlay } from '@/components/ui/drop-overlay'
import { confirmAction } from '@/lib/confirm'
import { formatShortDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { ReceiptDialog } from '@/components/receipts/ReceiptDialog'
import {
  DOMESTIC_RATES,
  TRIP_DAY_LABELS,
  tripAllowances,
  tripTimesError
} from '../../../../main/travel/allowances'
import {
  RECEIPT_CATEGORIES,
  RECEIPT_CATEGORY_LABELS,
  type ReceiptCategory,
  type ReceiptSource
} from '../../../../main/api/schemas/receipt.schema'
import type { TripDto, TripFields } from '../../../../main/api/schemas/trip.schema'
import { amountText } from '@/components/receipts/receiptForm'
import { parseAmount } from '@/lib/invoiceLabels'
import { toCents } from '../../../../main/einvoice/amounts'
import { t } from '../../../../main/i18n/translate'

/** What a receipt can be (as in the picker, receipt:pickFiles) */
const RECEIPT_EXTENSIONS = ['pdf', 'xml', 'jpg', 'jpeg', 'png'] as const

// #225 step 2: one business trip - the facts, the meals provided per day, the live allowances,
// its receipts, and the report that goes to DATEV.

const euro = (cents: number): string => `${amountText(cents)} €`
const DEFAULT_COMPANY = 0

const emptyTrip = (): TripFields => {
  const today = new Date().toISOString().slice(0, 10)
  return {
    companyId: null,
    personId: null,
    travellerName: '',
    purpose: '',
    destination: '',
    countryCode: 'DE',
    startAt: `${today}T08:00`,
    endAt: `${today}T18:00`,
    overnight: true,
    ratePartialCents: null,
    rateFullCents: null,
    kilometres: 0,
    vehicle: 'car',
    meals: {},
    category: 'other',
    notes: ''
  }
}

const fieldsOfTrip = (trip: TripDto): TripFields => ({
  companyId: trip.companyId,
  personId: trip.personId,
  travellerName: trip.travellerName,
  purpose: trip.purpose,
  destination: trip.destination,
  countryCode: trip.countryCode,
  startAt: trip.startAt,
  endAt: trip.endAt,
  overnight: trip.overnight,
  ratePartialCents: trip.ratePartialCents,
  rateFullCents: trip.rateFullCents,
  kilometres: trip.kilometres,
  vehicle: trip.vehicle,
  meals: trip.meals,
  category: trip.category,
  notes: trip.notes
})

export function TripDialog({
  open,
  onOpenChange,
  tripId
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null: a new trip */
  tripId: number | null
}) {
  const utils = trpcReact.useUtils()
  const [id, setId] = useState<number | null>(tripId)
  const tripQuery = trpcReact.trip.getById.useQuery(
    { id: id ?? 0 },
    { enabled: open && id !== null }
  )
  const trip = tripQuery.data ?? null
  const persons = trpcReact.person.getListItems.useQuery(undefined, { enabled: open })
  const companies = trpcReact.company.getListItems.useQuery(undefined, { enabled: open })
  const defaultCompany = trpcReact.company.getDefaultForInvoicing.useQuery(undefined, {
    enabled: open
  })
  const unassigned = trpcReact.trip.unassignedReceipts.useQuery(undefined, {
    enabled: open && id !== null
  })
  const [fields, setFields] = useState<TripFields | null>(tripId === null ? emptyTrip() : null)
  const [abroad, setAbroad] = useState({ partial: '', full: '' })
  const [dirty, setDirty] = useState(tripId === null)
  const [queue, setQueue] = useState<ReceiptSource[]>([])
  // Receipts dropped onto the section go the same way as "Neue Belege…" (after saving only)
  const receiptDrop = useFileDrop({
    extensions: RECEIPT_EXTENSIONS,
    disabled: id === null,
    onFiles: (paths) => setQueue(paths.map((path) => ({ kind: 'file' as const, path })))
  })

  // The stored trip fills the form once it is loaded
  if (fields === null && trip) {
    setFields(fieldsOfTrip(trip))
    setAbroad({
      partial: trip.ratePartialCents === null ? '' : amountText(trip.ratePartialCents),
      full: trip.rateFullCents === null ? '' : amountText(trip.rateFullCents)
    })
  }

  const set = (patch: Partial<TripFields>) => {
    setFields((current) => (current ? { ...current, ...patch } : current))
    setDirty(true)
  }

  const refresh = () => {
    void utils.trip.invalidate()
    void utils.receipt.invalidate()
  }
  const failed = (title: string) => (error: { message: string }) =>
    toast.error(title, { description: error.message })
  const create = trpcReact.trip.create.useMutation({
    onSuccess: (saved) => {
      setId(saved.id)
      setDirty(false)
      refresh()
      toast.success(t('Reise gespeichert'))
    },
    onError: failed(t('Reise konnte nicht gespeichert werden'))
  })
  const update = trpcReact.trip.update.useMutation({
    onSuccess: () => {
      setDirty(false)
      refresh()
      toast.success(t('Reise gespeichert'))
    },
    onError: failed(t('Reise konnte nicht gespeichert werden'))
  })
  const assign = trpcReact.trip.assignReceipt.useMutation({
    onSuccess: refresh,
    onError: failed(t('Beleg konnte nicht zugeordnet werden'))
  })
  const build = trpcReact.trip.buildReport.useMutation({
    onSuccess: () => {
      refresh()
      toast.success(t('Abrechnung erstellt'))
    },
    onError: failed(t('Abrechnung konnte nicht erstellt werden'))
  })
  const openFile = trpcReact.receipt.open.useMutation({
    onError: failed(t('Datei konnte nicht geöffnet werden'))
  })
  const send = trpcReact.receipt.sendToDatev.useMutation({
    onSuccess: (result) => {
      refresh()
      if (result.success) toast.success(t('An DATEV übergeben'), { description: result.to })
      else toast.error(t('Nicht an DATEV übergeben'), { description: result.error })
    },
    onError: failed(t('Nicht an DATEV übergeben'))
  })

  const timesError = fields ? tripTimesError(fields.startAt, fields.endAt) : null
  const allowances = useMemo(() => {
    if (!fields || timesError) return null
    return tripAllowances({
      startAt: fields.startAt,
      endAt: fields.endAt,
      overnight: fields.overnight,
      rates:
        fields.ratePartialCents !== null && fields.rateFullCents !== null
          ? { partialCents: fields.ratePartialCents, fullCents: fields.rateFullCents }
          : DOMESTIC_RATES,
      meals: fields.meals,
      kilometres: fields.kilometres,
      vehicle: fields.vehicle
    })
  }, [fields, timesError])

  const save = () => {
    if (!fields) return
    if (!fields.travellerName.trim()) {
      toast.error(t('Bitte die reisende Person angeben'))
      return
    }
    if (timesError) {
      toast.error(timesError)
      return
    }
    let ratePartialCents: number | null = null
    let rateFullCents: number | null = null
    if (fields.countryCode !== 'DE' && (abroad.partial.trim() || abroad.full.trim())) {
      const partial = parseAmount(abroad.partial)
      const full = parseAmount(abroad.full)
      if (partial === null || full === null) {
        toast.error(t('Bitte beide Pauschalen des Landes angeben (BMF-Tabelle)'))
        return
      }
      ratePartialCents = toCents(partial)
      rateFullCents = toCents(full)
    }
    const input = { ...fields, ratePartialCents, rateFullCents }
    if (id === null) create.mutate(input)
    else update.mutate({ ...input, id })
  }

  const sendReport = async () => {
    if (!trip?.report) return
    if (dirty) {
      toast.error(t('Bitte zuerst speichern und die Abrechnung neu erstellen'))
      return
    }
    if (trip.report.datev !== 'none') {
      const again = await confirmAction({
        title: t('Noch einmal an DATEV übergeben?'),
        description: t(
          'Die Abrechnung ist schon übergeben. Ein zweites Mal wird sie in DATEV ein zweiter Beleg.'
        ),
        confirmLabel: t('Trotzdem übergeben')
      })
      if (!again) return
    }
    send.mutate({ id: trip.report.receiptId })
  }

  const saving = create.isPending || update.isPending
  const days = allowances?.days ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>{id === null ? t('Neue Reise') : t('Reise bearbeiten')}</DialogTitle>
          <DialogDescription>
            {t(
              'Verpflegungspauschalen 2026 im Inland: 14 € ab mehr als 8 Stunden und für An- und Abreisetag, 28 € pro vollem Tag. Gestellte Mahlzeiten werden gekürzt.'
            )}
          </DialogDescription>
        </DialogHeader>

        {!fields && <p className="py-6 text-sm text-muted-foreground">{t('Wird geladen…')}</p>}
        {fields && (
          <div className="-mx-6 grid flex-1 gap-6 overflow-y-auto px-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="trip-person" className="mb-1 block">
                    {t('Reisende Person')}
                  </Label>
                  <SearchableSelect<number>
                    id="trip-person"
                    value={fields.personId}
                    onChange={(value) => {
                      const person = (persons.data ?? []).find((p) => p.id === value)
                      set({
                        personId: value,
                        travellerName: person
                          ? `${person.firstName} ${person.lastName}`.trim()
                          : fields.travellerName
                      })
                    }}
                    options={(persons.data ?? []).map((p) => ({
                      value: p.id,
                      label: `${p.firstName} ${p.lastName}`.trim()
                    }))}
                    noneLabel={t('Keine Person aus Bookingium')}
                    placeholder={t('Person wählen')}
                    searchPlaceholder={t('Person suchen…')}
                  />
                </div>
                <div>
                  <Label htmlFor="trip-traveller" className="mb-1 block">
                    {t('Name auf der Abrechnung')}
                  </Label>
                  <Input
                    id="trip-traveller"
                    value={fields.travellerName}
                    onChange={(e) => set({ travellerName: e.target.value })}
                  />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="trip-purpose" className="mb-1 block">
                    {t('Anlass')}
                  </Label>
                  <Input
                    id="trip-purpose"
                    placeholder={t('z. B. Tourbegleitung April Art, Herbst 2026')}
                    value={fields.purpose}
                    onChange={(e) => set({ purpose: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="trip-destination" className="mb-1 block">
                    {t('Reiseziel')}
                  </Label>
                  <Input
                    id="trip-destination"
                    value={fields.destination}
                    onChange={(e) => set({ destination: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="trip-country" className="mb-1 block">
                    {t('Land')}
                  </Label>
                  <Input
                    id="trip-country"
                    maxLength={2}
                    value={fields.countryCode}
                    onChange={(e) => set({ countryCode: e.target.value.toUpperCase() })}
                  />
                </div>
                <div>
                  <Label htmlFor="trip-start" className="mb-1 block">
                    {t('Beginn')}
                  </Label>
                  <Input
                    id="trip-start"
                    type="datetime-local"
                    value={fields.startAt}
                    onChange={(e) => set({ startAt: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="trip-end" className="mb-1 block">
                    {t('Ende')}
                  </Label>
                  <Input
                    id="trip-end"
                    type="datetime-local"
                    value={fields.endAt}
                    onChange={(e) => set({ endAt: e.target.value })}
                  />
                </div>
              </div>
              {timesError && <p className="text-sm text-destructive">{timesError}</p>}
              {days.length === 2 && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={fields.overnight}
                    onChange={(e) => set({ overnight: e.target.checked })}
                  />
                  {t('Mit Übernachtung (sonst über Mitternacht ohne Übernachtung: eine Pauschale)')}
                </label>
              )}
              {fields.countryCode !== 'DE' && (
                <div className="grid grid-cols-2 gap-3 rounded-md border border-dashed p-3">
                  <p className="col-span-2 text-xs text-muted-foreground">
                    {t(
                      'Auslandsreise: die Pauschalen des Landes aus der BMF-Tabelle des Jahres. Leer gelassen gelten die Inlandssätze.'
                    )}
                  </p>
                  <div>
                    <Label className="mb-1 block text-xs">{t('An-/Abreisetag, über 8 Std.')}</Label>
                    <Input
                      inputMode="decimal"
                      value={abroad.partial}
                      onChange={(e) => {
                        setAbroad({ ...abroad, partial: e.target.value })
                        setDirty(true)
                      }}
                    />
                  </div>
                  <div>
                    <Label className="mb-1 block text-xs">{t('Voller Tag (24 Std.)')}</Label>
                    <Input
                      inputMode="decimal"
                      value={abroad.full}
                      onChange={(e) => {
                        setAbroad({ ...abroad, full: e.target.value })
                        setDirty(true)
                      }}
                    />
                  </div>
                </div>
              )}

              {days.length > 0 && (
                <div>
                  <p className="mb-1 text-sm font-medium">{t('Gestellte Mahlzeiten')}</p>
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th className="py-1 text-left font-normal">{t('Tag')}</th>
                        <th className="py-1 text-left font-normal">{t('Art')}</th>
                        <th className="py-1 font-normal">{t('Frühstück')}</th>
                        <th className="py-1 font-normal">{t('Mittag')}</th>
                        <th className="py-1 font-normal">{t('Abend')}</th>
                        <th className="py-1 text-right font-normal">{t('Pauschale')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((day) => {
                        const meals = fields.meals[day.date] ?? {
                          breakfast: false,
                          lunch: false,
                          dinner: false
                        }
                        const toggle = (meal: keyof typeof meals) =>
                          set({
                            meals: {
                              ...fields.meals,
                              [day.date]: { ...meals, [meal]: !meals[meal] }
                            }
                          })
                        return (
                          <tr key={day.date} className="border-t">
                            <td className="py-1">{formatShortDate(day.date)}</td>
                            <td className="py-1 text-muted-foreground">
                              {TRIP_DAY_LABELS[day.kind]}
                            </td>
                            {(['breakfast', 'lunch', 'dinner'] as const).map((meal) => (
                              <td key={meal} className="py-1 text-center">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-primary"
                                  aria-label={`${formatShortDate(day.date)} ${
                                    {
                                      breakfast: t('Frühstück'),
                                      lunch: t('Mittagessen'),
                                      dinner: t('Abendessen')
                                    }[meal]
                                  } gestellt`}
                                  checked={meals[meal]}
                                  onChange={() => toggle(meal)}
                                />
                              </td>
                            ))}
                            <td className="py-1 text-right tabular-nums">{euro(day.netCents)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="trip-km" className="mb-1 block">
                    {t('Gefahrene km (eigenes Fahrzeug)')}
                  </Label>
                  <Input
                    id="trip-km"
                    inputMode="numeric"
                    value={String(fields.kilometres)}
                    onChange={(e) =>
                      set({ kilometres: Math.max(0, Math.round(Number(e.target.value) || 0)) })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="trip-vehicle" className="mb-1 block">
                    {t('Fahrzeug')}
                  </Label>
                  <Select
                    value={fields.vehicle}
                    onValueChange={(value) => set({ vehicle: value as 'car' | 'other' })}
                  >
                    <SelectTrigger id="trip-vehicle">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="car">{t('Pkw (0,30 €/km)')}</SelectItem>
                      <SelectItem value="other">{t('Anderes Kfz (0,20 €/km)')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="trip-category" className="mb-1 block">
                    DATEV-Belegart
                  </Label>
                  <Select
                    value={fields.category}
                    onValueChange={(value) => set({ category: value as ReceiptCategory })}
                  >
                    <SelectTrigger id="trip-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RECEIPT_CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>
                          {RECEIPT_CATEGORY_LABELS[category]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-3">
                  <Label htmlFor="trip-company" className="mb-1 block">
                    {t('Eigene Firma')}
                  </Label>
                  <SearchableSelect<number>
                    id="trip-company"
                    value={fields.companyId ?? DEFAULT_COMPANY}
                    onChange={(value) =>
                      set({ companyId: value === null || value === DEFAULT_COMPANY ? null : value })
                    }
                    options={[
                      {
                        value: DEFAULT_COMPANY,
                        label:
                          id === null
                            ? t('Standardfirma{{value}}', {
                                value: defaultCompany.data ? ` (${defaultCompany.data.name})` : ''
                              })
                            : t('Unverändert ({{value}})', {
                                value: trip?.companyName || t('keine')
                              })
                      },
                      ...(companies.data ?? []).map((c) => ({ value: c.id, label: c.name }))
                    ]}
                    searchPlaceholder={t('Firma suchen…')}
                  />
                </div>
                <div className="col-span-3">
                  <Label htmlFor="trip-notes" className="mb-1 block">
                    {t('Anmerkung')}
                  </Label>
                  <Textarea
                    id="trip-notes"
                    rows={2}
                    value={fields.notes}
                    onChange={(e) => set({ notes: e.target.value })}
                  />
                </div>
              </div>

              <div className="relative space-y-2 rounded-md" {...receiptDrop.dropProps}>
                <DropOverlay
                  show={receiptDrop.dragging}
                  title={t('Belege hier ablegen')}
                  hint={t('PDF, E-Rechnung (XML), JPG oder PNG')}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{t('Belege der Reise')}</p>
                  {id === null ? (
                    <span className="text-xs text-muted-foreground">{t('Nach dem Speichern')}</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <SearchableSelect<number>
                        aria-label={t('Vorhandenen Beleg zuordnen')}
                        value={null}
                        onChange={(receiptId) => {
                          if (receiptId !== null) assign.mutate({ receiptId, tripId: id })
                        }}
                        options={(unassigned.data ?? []).map((r) => ({
                          value: r.id,
                          label: [
                            r.receiptDate ? formatShortDate(r.receiptDate) : '',
                            r.supplierName || r.fileName
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        }))}
                        placeholder={t('Vorhandenen Beleg zuordnen')}
                        searchPlaceholder={t('Beleg suchen…')}
                        emptyText={t('Keine freien Belege')}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          const paths = await window.api.pickReceiptFiles()
                          setQueue(paths.map((path) => ({ kind: 'file' as const, path })))
                        }}
                      >
                        <Plus className="h-4 w-4" /> {t('Neue Belege…')}
                      </Button>
                    </div>
                  )}
                </div>
                {(trip?.receipts ?? []).length === 0 && id !== null && (
                  <p className="text-sm text-muted-foreground">
                    {t('Noch keine Belege zugeordnet.')}
                  </p>
                )}
                {(trip?.receipts ?? []).map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
                  >
                    <span className="w-24 text-muted-foreground">
                      {r.receiptDate ? formatShortDate(r.receiptDate) : '–'}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{r.supplierName || r.fileName}</span>
                    <span className="tabular-nums">
                      {r.amountCents === null
                        ? '–'
                        : `${amountText(r.amountCents)} ${r.currency === 'EUR' ? '€' : r.currency}`}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('Beleg von der Reise lösen')}
                      title={t('Von der Reise lösen')}
                      onClick={() => assign.mutate({ receiptId: r.id, tripId: null })}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="min-w-0 space-y-3 rounded-md border p-4 text-sm">
              <p className="font-medium">{t('Erstattung')}</p>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('Verpflegung')}</span>
                <span className="tabular-nums">{euro(allowances?.allowancesCents ?? 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('Kilometer')}</span>
                <span className="tabular-nums">{euro(allowances?.mileageCents ?? 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('Belege (EUR)')}</span>
                <span className="tabular-nums">{euro(trip?.receiptsCents ?? 0)}</span>
              </div>
              <div className="flex justify-between border-t pt-2 font-semibold">
                <span>{t('Gesamt')}</span>
                <span className="tabular-nums">
                  {euro(
                    (allowances?.allowancesCents ?? 0) +
                      (allowances?.mileageCents ?? 0) +
                      (trip?.receiptsCents ?? 0)
                  )}
                </span>
              </div>

              <div className="space-y-2 border-t pt-3">
                <p className="font-medium">{t('Abrechnung')}</p>
                {trip?.report ? (
                  <p className="text-xs text-muted-foreground">
                    {trip.report.fileName}{' '}
                    {trip.report.datev === 'sent' ? (
                      <Badge variant="secondary">{t('an DATEV übergeben')}</Badge>
                    ) : trip.report.datev === 'pending' ? (
                      <Badge variant="outline">{t('wird bestätigt')}</Badge>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t('Ein PDF: Übersicht und dahinter die Belege der Reise.')}
                  </p>
                )}
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={id === null || dirty || build.isPending}
                  title={dirty ? t('Zuerst speichern') : undefined}
                  onClick={() => id !== null && build.mutate({ id })}
                >
                  <FileText className="h-4 w-4" />
                  {trip?.report ? t('Abrechnung neu erstellen') : t('Abrechnung erstellen')}
                </Button>
                {trip?.report && (
                  <>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => openFile.mutate({ id: trip.report!.receiptId })}
                    >
                      <ExternalLink className="h-4 w-4" /> {t('Abrechnung öffnen')}
                    </Button>
                    <Button
                      className="w-full"
                      disabled={send.isPending}
                      onClick={() => void sendReport()}
                    >
                      <Landmark className="h-4 w-4" /> {t('An DATEV übergeben')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Schließen')}
          </Button>
          <Button onClick={save} disabled={!fields || saving || !dirty}>
            {saving ? t('Wird gespeichert…') : t('Speichern')}
          </Button>
        </DialogFooter>
      </DialogContent>

      {queue.length > 0 && id !== null && (
        <ReceiptDialog
          open
          onOpenChange={(next) => {
            if (!next) setQueue((current) => current.slice(1))
          }}
          source={queue[0]}
          position={{ index: 0, count: queue.length }}
          onSaved={(saved) => assign.mutate({ receiptId: saved.id, tripId: id })}
        />
      )}
    </Dialog>
  )
}
