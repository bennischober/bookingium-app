import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Printer, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { confirmAction } from '@/lib/confirm'
import { FormSheet } from '@/components/form-sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ManagementShareSection } from './ManagementShareSection'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type {
  ManagementContractDto,
  UpdateManagementContractInput
} from '../../../../main/api/schemas/management_contract.schema'

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-')
  return `${day}.${month}.${year}`
}

/** Label of a contract in the picker: its start date, else when it was created */
function contractLabel(contract: ManagementContractDto, isCurrent: boolean): string {
  const date = contract.startDate
    ? `ab ${formatDate(contract.startDate)}`
    : `angelegt am ${formatDate(contract.createdAt)}`
  return `Vertrag ${date}${isCurrent ? ' (aktuell)' : ''}`
}

/**
 * Management contracts of a band: pick one (newest = current), edit its
 * terms, print it, bill quarterly management shares from it, or start a
 * new one (a copy of the current terms).
 */
export function ManagementContractSheet({
  band,
  onClose
}: {
  band: { id: number; name: string } | null
  onClose: () => void
}) {
  const utils = trpcReact.useUtils()
  const contracts = trpcReact.managementContract.listByBand.useQuery(band?.id ?? 0, {
    enabled: band !== null
  })
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const list = contracts.data ?? []
  const selected = list.find((c) => c.id === selectedId) ?? list[0] ?? null

  const createMutation = trpcReact.managementContract.createForBand.useMutation({
    onSuccess: (created) => {
      void utils.managementContract.listByBand.invalidate(band?.id)
      setSelectedId(created.id)
      toast.success(
        list.length > 0
          ? 'Neuer Vertrag mit den aktuellen Konditionen angelegt'
          : 'Vertrag angelegt'
      )
    },
    onError: (error) =>
      toast.error('Vertrag konnte nicht angelegt werden', { description: error.message })
  })

  return (
    <FormSheet
      isOpen={band !== null}
      onClose={() => {
        setSelectedId(null)
        onClose()
      }}
      mode="edit"
      title={`Managementvertrag – ${band?.name ?? ''}`}
      description="Konditionen des Managementvertrags zwischen Management und Band."
    >
      {contracts.isLoading ? (
        <p className="text-sm text-muted-foreground">Verträge werden geladen…</p>
      ) : !selected ? (
        <div className="space-y-3 rounded-md border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Für diese Band gibt es noch keinen Managementvertrag.
          </p>
          <Button
            onClick={() => band && createMutation.mutate(band.id)}
            disabled={createMutation.isPending}
          >
            + Vertrag anlegen
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-2">
              <Label>Vertrag</Label>
              <Select
                value={String(selected.id)}
                onValueChange={(value) => setSelectedId(Number(value))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {list.map((contract, index) => (
                    <SelectItem key={contract.id} value={String(contract.id)}>
                      {contractLabel(contract, index === 0)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              onClick={() => band && createMutation.mutate(band.id)}
              disabled={createMutation.isPending}
              title="Neuer Vertrag mit den Konditionen des aktuellen"
            >
              + Neuer Vertrag
            </Button>
          </div>

          <Separator />

          {band && (
            <ContractForm
              key={selected.id}
              bandId={band.id}
              contract={selected}
              onDeleted={() => setSelectedId(null)}
            />
          )}
        </div>
      )}
    </FormSheet>
  )
}

function ContractForm({
  bandId,
  contract,
  onDeleted
}: {
  bandId: number
  contract: ManagementContractDto
  onDeleted: () => void
}) {
  const navigate = useNavigate()
  const utils = trpcReact.useUtils()
  const companies = trpcReact.company.getListItems.useQuery()
  const bandMembers = trpcReact.relation.getBandMembers.useQuery({ bandId })

  // Numbers are edited as text and parsed on save
  const [form, setForm] = useState({
    managementCompanyId: contract.managementCompanyId,
    startDate: contract.startDate ?? '',
    territory: contract.territory,
    termYears: String(contract.termYears),
    renewalYears: String(contract.renewalYears),
    noticeMonths: String(contract.noticeMonths),
    commissionPercent: String(contract.commissionPercent),
    excludedIncome: contract.excludedIncome,
    statementEmail: contract.statementEmail,
    settlementDays: String(contract.settlementDays),
    paymentDays: String(contract.paymentDays),
    postTermYear1Percent: String(contract.postTermYear1Percent),
    postTermYear2Percent: String(contract.postTermYear2Percent),
    postTermYear3Percent: String(contract.postTermYear3Percent),
    memberPersonIds: contract.memberPersonIds,
    representativePersonId: contract.representativePersonId,
    specialClauses: contract.specialClauses
  })
  const [dirty, setDirty] = useState(false)
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const updateMutation = trpcReact.managementContract.update.useMutation()
  const deleteMutation = trpcReact.managementContract.delete.useMutation({
    onSuccess: () => {
      void utils.managementContract.listByBand.invalidate(bandId)
      onDeleted()
      toast.success('Vertrag gelöscht')
    },
    onError: (error) =>
      toast.error('Vertrag konnte nicht gelöscht werden', { description: error.message })
  })

  const members = bandMembers.data ?? []
  const listedMembers = members.filter((m) => form.memberPersonIds.includes(m.personId))

  const toggleMember = (personId: number, checked: boolean) => {
    const next = checked
      ? [...form.memberPersonIds, personId]
      : form.memberPersonIds.filter((id) => id !== personId)
    set('memberPersonIds', next)
    // The authorized member must stay one of the listed members
    if (!checked && form.representativePersonId === personId) {
      set('representativePersonId', next[0] ?? null)
    }
  }

  /** Validates and saves; returns false (with a message) if invalid */
  const save = async (): Promise<boolean> => {
    const whole = (label: string, value: string) => {
      const n = Number(value)
      if (!Number.isInteger(n) || n < 0) throw new Error(`${label}: bitte eine ganze Zahl ≥ 0`)
      return n
    }
    const percent = (label: string, value: string) => {
      const n = Number(value.replace(',', '.'))
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`${label}: 0 bis 100 %`)
      return n
    }

    let payload: UpdateManagementContractInput
    try {
      payload = {
        id: contract.id,
        managementCompanyId: form.managementCompanyId,
        startDate: form.startDate || null,
        territory: form.territory.trim(),
        termYears: whole('Laufzeit', form.termYears),
        renewalYears: whole('Verlängerung', form.renewalYears),
        noticeMonths: whole('Kündigungsfrist', form.noticeMonths),
        commissionPercent: percent('Vergütung', form.commissionPercent),
        excludedIncome: form.excludedIncome.trim(),
        statementEmail: form.statementEmail.trim(),
        settlementDays: whole('Abrechnungsfrist', form.settlementDays),
        paymentDays: whole('Zahlungsfrist', form.paymentDays),
        postTermYear1Percent: percent('Nachvertraglich 1. Jahr', form.postTermYear1Percent),
        postTermYear2Percent: percent('Nachvertraglich 2. Jahr', form.postTermYear2Percent),
        postTermYear3Percent: percent('Nachvertraglich 3. Jahr', form.postTermYear3Percent),
        memberPersonIds: form.memberPersonIds,
        representativePersonId: form.representativePersonId,
        specialClauses: form.specialClauses
      }
    } catch (error) {
      toast.error('Bitte Eingaben prüfen', {
        description: error instanceof Error ? error.message : String(error)
      })
      return false
    }

    try {
      await updateMutation.mutateAsync(payload)
      await utils.managementContract.listByBand.invalidate(bandId)
      setDirty(false)
      return true
    } catch (error) {
      toast.error('Vertrag konnte nicht gespeichert werden', {
        description: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  const numberField = (key: keyof typeof form, label: string, suffix: string) => (
    <div className="space-y-2">
      <Label htmlFor={`mc-${key}`}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={`mc-${key}`}
          inputMode="decimal"
          value={form[key] as string}
          onChange={(e) => set(key, e.target.value as never)}
        />
        <span className="shrink-0 text-sm text-muted-foreground">{suffix}</span>
      </div>
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Bill with what is on screen: save pending changes first */}
      <ManagementShareSection
        bandId={bandId}
        contract={contract}
        beforeBilling={async () => !dirty || (await save())}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Management</Label>
          <Select
            value={form.managementCompanyId ? String(form.managementCompanyId) : ''}
            onValueChange={(value) => set('managementCompanyId', Number(value))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Firma auswählen" />
            </SelectTrigger>
            <SelectContent>
              {(companies.data ?? []).map((company) => (
                <SelectItem key={company.id} value={String(company.id)}>
                  {company.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="mc-start">Vertragsbeginn</Label>
          <Input
            id="mc-start"
            type="date"
            value={form.startDate}
            onChange={(e) => set('startDate', e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Datum der Letztunterschrift, sobald bekannt
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {numberField('commissionPercent', 'Vergütung', '% zzgl. USt.')}
        <div className="space-y-2">
          <Label htmlFor="mc-excluded">Ausgenommene Einnahmen</Label>
          <Input
            id="mc-excluded"
            value={form.excludedIncome}
            onChange={(e) => set('excludedIncome', e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {numberField('termYears', 'Laufzeit', 'Jahre')}
        {numberField('renewalYears', 'Verlängerung', 'Jahre')}
        {numberField('noticeMonths', 'Kündigungsfrist', 'Monate')}
      </div>

      <div className="space-y-2">
        <Label htmlFor="mc-territory">Vertragsgebiet</Label>
        <Input
          id="mc-territory"
          value={form.territory}
          onChange={(e) => set('territory', e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Satz im Vertrag: „… die vertragsgegenständlichen Aufgaben <em>{form.territory}</em>{' '}
          wahrzunehmen.“
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="mc-email">E-Mail für Abrechnungen</Label>
          <Input
            id="mc-email"
            type="email"
            value={form.statementEmail}
            onChange={(e) => set('statementEmail', e.target.value)}
          />
        </div>
        {numberField('settlementDays', 'Abrechnungsfrist', 'Tage nach Quartalsende')}
        {numberField('paymentDays', 'Zahlungsfrist', 'Tage nach Rechnung')}
      </div>

      <div className="space-y-2">
        <Label>Nachvertragliche Beteiligung (Anteil der Vergütung)</Label>
        <div className="grid grid-cols-3 gap-4">
          {numberField('postTermYear1Percent', '1. Jahr', '%')}
          {numberField('postTermYear2Percent', '2. Jahr', '%')}
          {numberField('postTermYear3Percent', '3. Jahr', '%')}
        </div>
      </div>

      <Separator />

      {/* Group clause: who is named as member/shareholder, and who receives
          notices, statements and payments for the group */}
      <div className="space-y-2">
        <Label>Mitglieder / Gesellschafter (Gruppenklausel)</Label>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Diese Band hat noch keine Mitglieder – über „Mitglieder“ in der Bandliste hinzufügen.
          </p>
        ) : (
          <div className="space-y-1 rounded-md border p-3">
            {members.map((member) => (
              <label key={member.personId} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={form.memberPersonIds.includes(member.personId)}
                  onChange={(e) => toggleMember(member.personId, e.target.checked)}
                />
                <span>{member.personName}</span>
                {member.role && <span className="text-muted-foreground">({member.role})</span>}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Bevollmächtigtes Mitglied</Label>
        <Select
          value={form.representativePersonId ? String(form.representativePersonId) : ''}
          onValueChange={(value) => set('representativePersonId', Number(value))}
          disabled={listedMembers.length === 0}
        >
          <SelectTrigger>
            <SelectValue placeholder="Mitglied auswählen" />
          </SelectTrigger>
          <SelectContent>
            {listedMembers.map((member) => (
              <SelectItem key={member.personId} value={String(member.personId)}>
                {member.personName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Empfängt Erklärungen, Abrechnungen und Zahlungen für die Gruppe (mit Adresse im Vertrag).
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="mc-special">Sondervereinbarungen</Label>
        <Textarea
          id="mc-special"
          rows={3}
          value={form.specialClauses}
          onChange={(e) => set('specialClauses', e.target.value)}
          placeholder="Erscheint als eigener Paragraph am Vertragsende"
        />
      </div>

      <div className="flex items-center justify-between gap-2 border-t pt-4">
        <Button
          variant="ghost"
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          disabled={deleteMutation.isPending}
          onClick={async () => {
            if (
              await confirmAction({
                title: 'Diesen Vertrag löschen?',
                description: 'Der Vertrag und seine Konditionen werden endgültig entfernt.',
                confirmLabel: 'Löschen',
                destructive: true
              })
            ) {
              deleteMutation.mutate(contract.id)
            }
          }}
        >
          <Trash2 className="h-4 w-4" /> Löschen
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={updateMutation.isPending}
            onClick={async () => {
              // Print what is on screen: save pending changes first
              if (dirty && !(await save())) return
              void navigate({
                to: '/management-contracts/$contractId/print',
                params: { contractId: String(contract.id) }
              })
            }}
          >
            <Printer className="h-4 w-4" /> Drucken / PDF
          </Button>
          <Button
            disabled={!dirty || updateMutation.isPending}
            onClick={async () => {
              if (await save()) toast.success('Vertrag gespeichert')
            }}
          >
            Speichern
          </Button>
        </div>
      </div>
    </div>
  )
}
