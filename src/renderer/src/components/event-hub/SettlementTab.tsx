import { useMemo, useState } from 'react'
import { useSyncedState, useSyncedStateByKey } from '@/hooks/useSyncedState'
import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Plus, Receipt, Trash2 } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { invoiceNumberLabel } from '@/lib/invoiceLabels'
import {
  computeSettlement,
  EMPTY_SETTLEMENT,
  managementFee,
  type SettlementInput,
  type SettlementTicketLine
} from '../../../../main/settlement/settlement'
import type { SettlementSheetDto } from '../../../../main/api/schemas/settlement.schema'
import { centsText, euroText, parseCents, parsePercent } from './settlementForm'

// #228: the promoter's settlement of the show (Konzertabrechnung) - read from the agency's Excel
// or typed in - with the live result, and the management fee invoice made from it.

/** A money field: typed freely, taken as cents when it leaves the field */
function MoneyInput({
  cents,
  onChange,
  id,
  label
}: {
  cents: number
  onChange: (cents: number) => void
  id?: string
  label?: string
}) {
  const [text, setText] = useSyncedState(centsText(cents))
  return (
    <Input
      id={id}
      aria-label={label}
      inputMode="decimal"
      className="text-right"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const parsed = parseCents(text)
        if (parsed === null) setText(centsText(cents))
        else onChange(parsed)
      }}
    />
  )
}

function PercentInput({
  value,
  onChange,
  label
}: {
  value: number
  onChange: (value: number) => void
  label: string
}) {
  const [text, setText] = useSyncedState(String(value).replace('.', ','))
  return (
    <Input
      aria-label={label}
      inputMode="decimal"
      className="w-20 text-right"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const parsed = parsePercent(text)
        if (parsed === null) setText(String(value).replace('.', ','))
        else onChange(parsed)
      }}
    />
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-1 text-sm ${strong ? 'font-semibold' : ''}`}>
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

const emptyLine = (): SettlementTicketLine => ({
  system: '',
  category: '',
  priceCents: 0,
  extraCents: 0,
  sold: 0,
  wkzCents: 0
})

/** #235: the promoter's last sales report beside the tickets settled, a large gap pointed out */
function LastTicketReport({ eventId, settled }: { eventId: number; settled: number }) {
  const show = trpcReact.advancing.get.useQuery({ eventId })
  const report = show.data?.reports[0]
  if (!report) return null
  const gap = settled > 0 ? Math.abs(settled - report.sold) / Math.max(settled, report.sold) : 0
  return (
    <p
      className={
        gap > 0.1 ? 'text-sm text-amber-700 dark:text-amber-400' : 'text-sm text-muted-foreground'
      }
    >
      Letzte Ticketmeldung: {report.sold.toLocaleString('de-DE')} am{' '}
      {new Date(`${report.reportDate}T00:00:00`).toLocaleDateString('de-DE')}
      {gap > 0.1 &&
        settled > 0 &&
        ` – weicht von den abgerechneten ${settled.toLocaleString('de-DE')} ab`}
    </p>
  )
}

export function SettlementTab({ eventId }: { eventId: number }) {
  const utils = trpcReact.useUtils()
  const navigate = useNavigate()
  const query = trpcReact.settlement.get.useQuery({ eventId })
  // The stored settlement, followed when it is saved or changed elsewhere
  const stored = query.data?.input ?? null
  const [input, setInput] = useSyncedStateByKey<SettlementInput | null>(
    stored,
    `${query.data?.updatedAt ?? ''}|${JSON.stringify(stored)}`
  )
  const [sourceFileName, setSourceFileName] = useSyncedState(query.data?.sourceFileName ?? '')
  // The promoter's file read but not saved yet: it goes to the documents on save
  const [pendingFile, setPendingFile] = useState<{
    path: string
    sheet: SettlementSheetDto
  } | null>(null)
  const [dirty, setDirty] = useState(false)

  const failed = (title: string) => (error: { message: string }) =>
    toast.error(title, { description: error.message })
  const readFile = trpcReact.settlement.readFile.useMutation({
    onError: failed('Abrechnung konnte nicht gelesen werden')
  })
  const attachFile = trpcReact.settlement.attachFile.useMutation()
  const save = trpcReact.settlement.save.useMutation({
    onSuccess: async () => {
      if (pendingFile) {
        try {
          await attachFile.mutateAsync({ eventId, path: pendingFile.path })
          void utils.document.invalidate()
        } catch (error) {
          toast.error('Die Excel-Datei wurde nicht bei den Dokumenten abgelegt', {
            description: error instanceof Error ? error.message : undefined
          })
        }
      }
      setPendingFile(null)
      setDirty(false)
      void utils.settlement.get.invalidate({ eventId })
      toast.success('Abrechnung gespeichert')
    },
    onError: failed('Abrechnung konnte nicht gespeichert werden')
  })
  const createFee = trpcReact.settlement.createFeeInvoice.useMutation({
    onSuccess: () => {
      void utils.settlement.get.invalidate({ eventId })
      void utils.invoice.invalidate()
      toast.success('Managementbeteiligung als Entwurf erstellt')
    },
    onError: failed('Managementbeteiligung nicht erstellt')
  })

  const result = useMemo(() => (input ? computeSettlement(input) : null), [input])
  const contract = query.data?.contract ?? null
  const fee =
    result && contract
      ? managementFee(result.gageCents, contract.agencyPercent, contract.commissionPercent, 19)
      : null

  const update = (patch: Partial<SettlementInput>) => {
    setInput((current) => ({ ...(current ?? EMPTY_SETTLEMENT), ...patch }))
    setDirty(true)
  }
  const updateLine = (index: number, patch: Partial<SettlementTicketLine>) =>
    update({
      lines: (input?.lines ?? []).map((line, i) => (i === index ? { ...line, ...patch } : line))
    })

  const importExcel = async () => {
    const path = await window.api.pickSettlementFile()
    if (!path) return
    const sheet = await readFile.mutateAsync({ path }).catch(() => null)
    if (!sheet) return
    setInput(sheet.input)
    setSourceFileName(sheet.fileName)
    setPendingFile({ path, sheet })
    setDirty(true)
  }

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Wird geladen…</p>

  // The computation against what the promoter's sheet shows, to the cent
  const check =
    pendingFile && result
      ? pendingFile.sheet.sheet.totalNetCents === null ||
        pendingFile.sheet.sheet.totalNetCents === result.totalOpenNetCents
      : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Abrechnung des Veranstalters</h2>
          <p className="text-sm text-muted-foreground">
            {sourceFileName ? `Aus „${sourceFileName}“` : 'Noch keine Abrechnung erfasst.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void importExcel()}
            disabled={readFile.isPending}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Excel einlesen…
          </Button>
          {!input && (
            <Button variant="outline" onClick={() => update({ lines: [emptyLine()] })}>
              <Plus className="h-4 w-4" />
              Von Hand erfassen
            </Button>
          )}
          {input && (
            <Button
              onClick={() => save.mutate({ eventId, input, sourceFileName })}
              disabled={!dirty || save.isPending}
            >
              {save.isPending ? 'Wird gespeichert…' : 'Speichern'}
            </Button>
          )}
        </div>
      </div>

      {pendingFile && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
          {check ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          )}
          <span>
            {pendingFile.sheet.artist} · {pendingFile.sheet.venue}, {pendingFile.sheet.city} ·{' '}
            {pendingFile.sheet.promoter}
          </span>
          <span className="text-muted-foreground">
            {check
              ? '– die Summen stimmen mit der Excel überein.'
              : `– die Excel zeigt ${euroText(pendingFile.sheet.sheet.totalNetCents ?? 0)} netto, berechnet sind ${euroText(result?.totalOpenNetCents ?? 0)}. Bitte prüfen.`}
          </span>
          <span className="text-muted-foreground">
            Beim Speichern kommt die Datei zu den Dokumenten.
          </span>
        </div>
      )}

      {input && result && (
        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tickets</CardTitle>
                <LastTicketReport eventId={eventId} settled={result.sold} />
              </CardHeader>
              <CardContent className="space-y-2">
                {/* In a narrow window only the ticket table scrolls sideways, not the page */}
                <div className="overflow-x-auto">
                  <div className="min-w-[48rem] space-y-2">
                    <div className="grid grid-cols-[1fr_1fr_6rem_6rem_5rem_5rem_2rem] gap-2 text-xs text-muted-foreground">
                      <span>Ticketsystem</span>
                      <span>Kategorie</span>
                      <span className="text-right">Preis (brutto)</span>
                      <span className="text-right">Gebühren</span>
                      <span className="text-right">Verkauft</span>
                      <span className="text-right">WKZ / Ticket</span>
                      <span />
                    </div>
                    {input.lines.map((line, index) => (
                      <div
                        key={index}
                        className="grid grid-cols-[1fr_1fr_6rem_6rem_5rem_5rem_2rem] items-center gap-2"
                      >
                        <Input
                          aria-label="Ticketsystem"
                          value={line.system}
                          onChange={(e) => updateLine(index, { system: e.target.value })}
                        />
                        <Input
                          aria-label="Kategorie"
                          value={line.category}
                          onChange={(e) => updateLine(index, { category: e.target.value })}
                        />
                        <MoneyInput
                          label="Preis"
                          cents={line.priceCents}
                          onChange={(cents) => updateLine(index, { priceCents: cents })}
                        />
                        <MoneyInput
                          label="Gebühren"
                          cents={line.extraCents}
                          onChange={(cents) => updateLine(index, { extraCents: cents })}
                        />
                        <Input
                          aria-label="Verkauft"
                          inputMode="numeric"
                          className="text-right"
                          value={String(line.sold)}
                          onChange={(e) =>
                            updateLine(index, {
                              sold: Math.max(0, Math.round(Number(e.target.value) || 0))
                            })
                          }
                        />
                        <MoneyInput
                          label="WKZ pro Ticket"
                          cents={line.wkzCents}
                          onChange={(cents) => updateLine(index, { wkzCents: cents })}
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Zeile entfernen"
                          onClick={() =>
                            update({ lines: input.lines.filter((_, i) => i !== index) })
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => update({ lines: [...input.lines, emptyLine()] })}
                >
                  <Plus className="h-4 w-4" /> Ticketzeile
                </Button>
                <div className="flex items-center gap-2 pt-2 text-sm">
                  <Label>MwSt. Tickets und WKZ</Label>
                  <PercentInput
                    label="MwSt. Tickets"
                    value={input.ticketVatRate}
                    onChange={(value) => update({ ticketVatRate: value })}
                  />
                  <span className="text-muted-foreground">%</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Deal</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <Label htmlFor="settlement-guarantee" className="mb-1 block">
                      Garantie (netto)
                    </Label>
                    <MoneyInput
                      id="settlement-guarantee"
                      cents={input.guaranteeCents}
                      onChange={(cents) => update({ guaranteeCents: cents })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="settlement-mode" className="mb-1 block">
                      Art
                    </Label>
                    <Select
                      value={input.dealMode}
                      onValueChange={(value) => update({ dealMode: value as 'versus' | 'plus' })}
                    >
                      <SelectTrigger id="settlement-mode" className="w-64">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="versus">Garantie gegen Beteiligung (VS)</SelectItem>
                        <SelectItem value="plus">Garantie plus Beteiligung ab Break</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label>MwSt. Gage</Label>
                    <PercentInput
                      label="MwSt. Gage"
                      value={input.gageVatRate}
                      onChange={(value) => update({ gageVatRate: value })}
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>
                {input.tiers.map((tier, index) => (
                  <div key={index} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-36 text-muted-foreground">Beteiligung {index + 1}</span>
                    <PercentInput
                      label={`Beteiligung ${index + 1} Prozent`}
                      value={tier.percent}
                      onChange={(value) =>
                        update({
                          tiers: input.tiers.map((t, i) =>
                            i === index ? { ...t, percent: value } : t
                          )
                        })
                      }
                    />
                    <span>% der Nettoeinnahmen ab</span>
                    <div className="w-32">
                      <MoneyInput
                        label={`Beteiligung ${index + 1} ab`}
                        cents={tier.fromCents}
                        onChange={(cents) =>
                          update({
                            tiers: input.tiers.map((t, i) =>
                              i === index ? { ...t, fromCents: cents } : t
                            )
                          })
                        }
                      />
                    </div>
                    <span className="ml-auto tabular-nums text-muted-foreground">
                      {euroText(result.tierCents[index] ?? 0)}
                    </span>
                  </div>
                ))}
                {input.tiers.length < 4 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      update({ tiers: [...input.tiers, { percent: 0, fromCents: 0 }] })
                    }
                  >
                    <Plus className="h-4 w-4" /> Stufe
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Nebenkosten, Support, Abschläge</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {input.costs.map((cost, index) => (
                  <div key={index} className="grid grid-cols-[1fr_8rem_2rem] items-center gap-2">
                    <Input
                      aria-label="Nebenkosten Bezeichnung"
                      value={cost.label}
                      onChange={(e) =>
                        update({
                          costs: input.costs.map((c, i) =>
                            i === index ? { ...c, label: e.target.value } : c
                          )
                        })
                      }
                    />
                    <MoneyInput
                      label="Nebenkosten netto"
                      cents={cost.netCents}
                      onChange={(cents) =>
                        update({
                          costs: input.costs.map((c, i) =>
                            i === index ? { ...c, netCents: cents } : c
                          )
                        })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Nebenkosten entfernen"
                      onClick={() => update({ costs: input.costs.filter((_, i) => i !== index) })}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      update({
                        costs: [...input.costs, { label: 'Übernachtungspauschale', netCents: 0 }]
                      })
                    }
                  >
                    <Plus className="h-4 w-4" /> Nebenkosten
                  </Button>
                  <Label className="ml-4">MwSt. Nebenkosten</Label>
                  <PercentInput
                    label="MwSt. Nebenkosten"
                    value={input.costsVatRate}
                    onChange={(value) => update({ costsVatRate: value })}
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-3 lg:grid-cols-4">
                  {(
                    [
                      ['gageCents', 'Abschlag Gage'],
                      ['wkzCents', 'Abschlag WKZ'],
                      ['costsCents', 'Abschlag Nebenkosten'],
                      ['supportCents', 'Abschlag Support']
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key}>
                      <Label className="mb-1 block text-xs">{label} (netto)</Label>
                      <MoneyInput
                        label={label}
                        cents={input.advances[key]}
                        onChange={(cents) =>
                          update({ advances: { ...input.advances, [key]: cents } })
                        }
                      />
                    </div>
                  ))}
                  <div>
                    <Label className="mb-1 block text-xs">Supportfee (netto)</Label>
                    <MoneyInput
                      label="Supportfee"
                      cents={input.supportFeeCents}
                      onChange={(cents) => update({ supportFeeCents: cents })}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="min-w-0 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ergebnis</CardTitle>
              </CardHeader>
              <CardContent>
                <Row
                  label={`Tickets (${result.sold}) brutto`}
                  value={euroText(result.ticketGrossCents)}
                />
                <Row label="Tickets netto" value={euroText(result.ticketNetCents)} />
                <Row
                  label={`Gage netto (${result.gageFrom === 'guarantee' ? 'Garantie' : 'Beteiligung'})`}
                  value={euroText(result.gageCents)}
                />
                <Row label="Gage brutto, offen" value={euroText(result.gage.openGrossCents)} />
                <Row label="WKZ netto" value={euroText(result.wkzNetCents)} />
                <Row label="Nebenkosten netto" value={euroText(result.costs.netCents)} />
                <div className="mt-2 border-t pt-2">
                  <Row
                    label="Offen netto (ohne Support)"
                    value={euroText(result.totalOpenNetCents)}
                    strong
                  />
                  <Row
                    label="Offen brutto (ohne Support)"
                    value={euroText(result.totalOpenGrossCents)}
                    strong
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Managementbeteiligung</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {!contract && (
                  <p className="text-sm text-muted-foreground">
                    Die Band hat keinen Managementvertrag. Die Beteiligung wird aus dem Vertrag
                    berechnet (Bands › Managementvertrag).
                  </p>
                )}
                {contract && fee && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {contract.managementCompanyName || 'Management'} · nur auf die Gage, ohne WKZ
                      und Nebenkosten
                    </p>
                    <Row label="Gage netto" value={euroText(fee.baseCents)} />
                    <Row
                      label={`abzgl. ${contract.agencyPercent} % Agentur`}
                      value={`− ${euroText(fee.agencyCents)}`}
                    />
                    <Row
                      label={`davon ${contract.commissionPercent} %`}
                      value={euroText(fee.netCents)}
                    />
                    <Row label="zzgl. 19 % MwSt." value={euroText(fee.vatCents)} />
                    <Row label="Rechnung brutto" value={euroText(fee.grossCents)} strong />
                    {query.data?.feeInvoice && query.data.feeInvoice.status !== 'cancelled' ? (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() =>
                          navigate({
                            to: '/invoices/$invoiceId',
                            params: { invoiceId: String(query.data!.feeInvoice!.id) }
                          })
                        }
                      >
                        <Receipt className="h-4 w-4" />
                        {query.data.feeInvoice.invoiceNumber === null
                          ? 'Entwurf öffnen'
                          : `${invoiceNumberLabel(query.data.feeInvoice.invoiceNumber)} öffnen`}
                      </Button>
                    ) : (
                      <Button
                        className="w-full"
                        disabled={dirty || createFee.isPending || fee.netCents <= 0}
                        title={dirty ? 'Zuerst die Abrechnung speichern' : undefined}
                        onClick={() => createFee.mutate({ eventId })}
                      >
                        <Receipt className="h-4 w-4" />
                        Managementbeteiligung erstellen
                      </Button>
                    )}
                    {query.data?.feeInvoice?.status === 'cancelled' && (
                      <Badge variant="outline">Die letzte Rechnung ist storniert</Badge>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
