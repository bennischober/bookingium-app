import { SearchableSelect } from '@/components/ui/searchable-select'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Plus, Printer, Trash2 } from 'lucide-react'
import { TabHeader } from '@/components/detail/DetailParts'
import { countLabel } from '@/components/detail/tableSort'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { confirmAction } from '@/lib/confirm'
import { FormSheet } from '@/components/form-sheet'
import { useReportUnsavedChanges } from '@/components/formGuard'
import { Button } from '@/components/ui/button'
import { FormActions } from '@/components/forms/FormActions'
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
import { t } from '../../../../main/i18n/translate'

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-')
  return `${day}.${month}.${year}`
}

/** Label of a contract in the picker: its start date, else when it was created */
function contractLabel(contract: ManagementContractDto, isCurrent: boolean): string {
  const date = contract.startDate
    ? `ab ${formatDate(contract.startDate)}`
    : `angelegt am ${formatDate(contract.createdAt)}`
  return t('Vertrag {{date}}{{value}}', { date, value: isCurrent ? t(' (aktuell)') : '' })
}

/**
 * Management contracts of a band: pick one (newest = current), edit its
 * terms, print it, bill quarterly management shares from it, or start a
 * new one (a copy of the current terms).
 */
export function ManagementContractPanel({ bandId }: { bandId: number }) {
  const utils = trpcReact.useUtils()
  const contracts = trpcReact.managementContract.listByBand.useQuery(bandId)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const list = contracts.data ?? []
  const selected = list.find((c) => c.id === selectedId) ?? list[0] ?? null

  const createMutation = trpcReact.managementContract.createForBand.useMutation({
    onSuccess: (created) => {
      void utils.managementContract.listByBand.invalidate(bandId)
      setSelectedId(created.id)
      toast.success(
        list.length > 0
          ? t('Neuer Vertrag mit den aktuellen Konditionen angelegt')
          : t('Vertrag angelegt')
      )
    },
    onError: (error) =>
      toast.error(t('Vertrag konnte nicht angelegt werden'), { description: error.message })
  })

  if (contracts.isLoading) {
    return <p className="text-sm text-muted-foreground">{t('Verträge werden geladen…')}</p>
  }

  return (
    <div className="space-y-5">
      <TabHeader
        summary={
          selected
            ? countLabel(list.length, t('Vertrag'), t('Verträge'))
            : t('Für diese Band gibt es noch keinen Managementvertrag.')
        }
      >
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => createMutation.mutate(bandId)}
          disabled={createMutation.isPending}
          title={selected ? t('Neuer Vertrag mit den Konditionen des aktuellen') : undefined}
        >
          <Plus className="h-4 w-4" />
          {t('Neuer Vertrag')}
        </Button>
      </TabHeader>

      {selected && (
        // The contract form reads best at a form's width
        <div className="max-w-3xl space-y-5">
          <div className="space-y-2">
            <Label>{t('Vertrag')}</Label>
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

          <Separator />

          <ContractForm
            key={selected.id}
            bandId={bandId}
            contract={selected}
            onDeleted={() => setSelectedId(null)}
          />
        </div>
      )}
    </div>
  )
}

/** Side sheet with a band's management contracts (Bands list) */
export function ManagementContractSheet({
  band,
  onClose
}: {
  band: { id: number; name: string } | null
  onClose: () => void
}) {
  return (
    <FormSheet
      isOpen={band !== null}
      onClose={onClose}
      mode="edit"
      title={t('Managementvertrag – {{value}}', { value: band?.name ?? '' })}
      description={t('Konditionen des Managementvertrags zwischen Management und Band.')}
    >
      {band && <ManagementContractPanel key={band.id} bandId={band.id} />}
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
    agencyPercent: String(contract.agencyPercent),
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
  useReportUnsavedChanges(dirty)
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const updateMutation = trpcReact.managementContract.update.useMutation()
  const deleteMutation = trpcReact.managementContract.delete.useMutation({
    onSuccess: () => {
      void utils.managementContract.listByBand.invalidate(bandId)
      onDeleted()
      toast.success(t('Vertrag gelöscht'))
    },
    onError: (error) =>
      toast.error(t('Vertrag konnte nicht gelöscht werden'), { description: error.message })
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
      if (!Number.isInteger(n) || n < 0)
        throw new Error(t('{{label}}: bitte eine ganze Zahl ≥ 0', { label }))
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
        termYears: whole(t('Laufzeit'), form.termYears),
        renewalYears: whole(t('Verlängerung'), form.renewalYears),
        noticeMonths: whole(t('Kündigungsfrist'), form.noticeMonths),
        commissionPercent: percent(t('Vergütung'), form.commissionPercent),
        agencyPercent: percent(t('Agenturprovision'), form.agencyPercent),
        excludedIncome: form.excludedIncome.trim(),
        statementEmail: form.statementEmail.trim(),
        settlementDays: whole(t('Abrechnungsfrist'), form.settlementDays),
        paymentDays: whole(t('Zahlungsfrist'), form.paymentDays),
        postTermYear1Percent: percent(t('Nachvertraglich 1. Jahr'), form.postTermYear1Percent),
        postTermYear2Percent: percent(t('Nachvertraglich 2. Jahr'), form.postTermYear2Percent),
        postTermYear3Percent: percent(t('Nachvertraglich 3. Jahr'), form.postTermYear3Percent),
        memberPersonIds: form.memberPersonIds,
        representativePersonId: form.representativePersonId,
        specialClauses: form.specialClauses
      }
    } catch (error) {
      toast.error(t('Bitte Eingaben prüfen'), {
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
      toast.error(t('Vertrag konnte nicht gespeichert werden'), {
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
          <Label htmlFor="mc-management">{t('Management')}</Label>
          <SearchableSelect
            id="mc-management"
            value={form.managementCompanyId || null}
            onChange={(value) => value !== null && set('managementCompanyId', value)}
            options={(companies.data ?? []).map((company) => ({
              value: company.id,
              label: company.name
            }))}
            placeholder={t('Firma auswählen')}
            searchPlaceholder={t('Firma suchen…')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mc-start">{t('Vertragsbeginn')}</Label>
          <Input
            id="mc-start"
            type="date"
            value={form.startDate}
            onChange={(e) => set('startDate', e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {t('Datum der Letztunterschrift, sobald bekannt')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {numberField('commissionPercent', t('Vergütung'), t('% zzgl. USt.'))}
        {numberField('agencyPercent', t('Agenturprovision (vor der Vergütung)'), t('% der Gage'))}
        <div className="space-y-2">
          <Label htmlFor="mc-excluded">{t('Ausgenommene Einnahmen')}</Label>
          <Input
            id="mc-excluded"
            value={form.excludedIncome}
            onChange={(e) => set('excludedIncome', e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {numberField('termYears', t('Laufzeit'), t('Jahre'))}
        {numberField('renewalYears', t('Verlängerung'), t('Jahre'))}
        {numberField('noticeMonths', t('Kündigungsfrist'), t('Monate'))}
      </div>

      <div className="space-y-2">
        <Label htmlFor="mc-territory">{t('Vertragsgebiet')}</Label>
        <Input
          id="mc-territory"
          value={form.territory}
          onChange={(e) => set('territory', e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {t('Satz im Vertrag: „… die vertragsgegenständlichen Aufgaben')} <em>{form.territory}</em>{' '}
          wahrzunehmen.“
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="mc-email">{t('E-Mail für Abrechnungen')}</Label>
          <Input
            id="mc-email"
            type="email"
            value={form.statementEmail}
            onChange={(e) => set('statementEmail', e.target.value)}
          />
        </div>
        {numberField('settlementDays', t('Abrechnungsfrist'), t('Tage nach Quartalsende'))}
        {numberField('paymentDays', t('Zahlungsfrist'), t('Tage nach Rechnung'))}
      </div>

      <div className="space-y-2">
        <Label>{t('Nachvertragliche Beteiligung (Anteil der Vergütung)')}</Label>
        <div className="grid grid-cols-3 gap-4">
          {numberField('postTermYear1Percent', t('1. Jahr'), '%')}
          {numberField('postTermYear2Percent', t('2. Jahr'), '%')}
          {numberField('postTermYear3Percent', t('3. Jahr'), '%')}
        </div>
      </div>

      <Separator />

      {/* Group clause: who is named as member/shareholder, and who receives
          notices, statements and payments for the group */}
      <div className="space-y-2">
        <Label>{t('Mitglieder / Gesellschafter (Gruppenklausel)')}</Label>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t(
              'Diese Band hat noch keine Mitglieder – über „Mitglieder“ in der Bandliste hinzufügen.'
            )}
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
        <Label>{t('Bevollmächtigtes Mitglied')}</Label>
        <Select
          value={form.representativePersonId ? String(form.representativePersonId) : ''}
          onValueChange={(value) => set('representativePersonId', Number(value))}
          disabled={listedMembers.length === 0}
        >
          <SelectTrigger>
            <SelectValue placeholder={t('Mitglied auswählen')} />
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
          {t(
            'Empfängt Erklärungen, Abrechnungen und Zahlungen für die Gruppe (mit Adresse im Vertrag).'
          )}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="mc-special">{t('Sondervereinbarungen')}</Label>
        <Textarea
          id="mc-special"
          rows={3}
          value={form.specialClauses}
          onChange={(e) => set('specialClauses', e.target.value)}
          placeholder={t('Erscheint als eigener Paragraph am Vertragsende')}
        />
      </div>

      <FormActions className="items-center justify-between">
        <Button
          variant="ghost"
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          disabled={deleteMutation.isPending}
          onClick={async () => {
            if (
              await confirmAction({
                title: t('Diesen Vertrag löschen?'),
                description: t('Der Vertrag und seine Konditionen werden endgültig entfernt.'),
                confirmLabel: t('Löschen'),
                destructive: true
              })
            ) {
              deleteMutation.mutate(contract.id)
            }
          }}
        >
          <Trash2 className="h-4 w-4" /> {t('Löschen')}
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
            <Printer className="h-4 w-4" /> {t('Drucken / PDF')}
          </Button>
          <Button
            disabled={!dirty || updateMutation.isPending}
            onClick={async () => {
              if (await save()) toast.success(t('Vertrag gespeichert'))
            }}
          >
            {t('Speichern')}
          </Button>
        </div>
      </FormActions>
    </div>
  )
}
