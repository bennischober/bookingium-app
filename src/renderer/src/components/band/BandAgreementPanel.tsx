import { useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Plus, Printer, Trash2, X } from 'lucide-react'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { TabHeader } from '@/components/detail/DetailParts'
import { countLabel } from '@/components/detail/tableSort'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { confirmAction } from '@/lib/confirm'
import { useReportUnsavedChanges } from '@/components/formGuard'
import { Button } from '@/components/ui/button'
import { FormActions } from '@/components/forms/FormActions'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type {
  BandAgreementDto,
  BandAgreementKind,
  LabelRoyaltyTier,
  LabelTerms,
  PublishingTerms
} from '../../../../main/api/schemas/band_agreement.schema'
import { t } from '../../../../main/i18n/translate'

// ========================================
// Publishing and label agreements of a band
// ========================================

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-')
  return `${day}.${month}.${year}`
}

function agreementLabel(agreement: BandAgreementDto, isCurrent: boolean): string {
  const date = agreement.startDate
    ? `ab ${formatDate(agreement.startDate)}`
    : `angelegt am ${formatDate(agreement.createdAt)}`
  return t('Vertrag {{date}}{{value}}', { date, value: isCurrent ? t(' (aktuell)') : '' })
}

const KIND_TEXT: Record<
  BandAgreementKind,
  { empty: string; counterparty: string; created: string }
> = {
  publishing: {
    empty: t('Für diese Band gibt es noch keinen Verlagsvertrag.'),
    counterparty: t('Verlag'),
    created: t('Verlagsvertrag angelegt')
  },
  label: {
    empty: t('Für diese Band gibt es noch keinen Labelvertrag.'),
    counterparty: t('Label'),
    created: t('Labelvertrag angelegt')
  }
}

/**
 * A band's agreements of one kind: pick one (newest = current), edit its terms, print it, or
 * start a new one (a copy of the current terms)
 */
export function BandAgreementPanel({ bandId, kind }: { bandId: number; kind: BandAgreementKind }) {
  const utils = trpcReact.useUtils()
  const agreements = trpcReact.bandAgreement.listByBand.useQuery(bandId)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const list = (agreements.data ?? []).filter((agreement) => agreement.kind === kind)
  const selected = list.find((a) => a.id === selectedId) ?? list[0] ?? null
  const text = KIND_TEXT[kind]

  const createMutation = trpcReact.bandAgreement.create.useMutation({
    onSuccess: (created) => {
      void utils.bandAgreement.listByBand.invalidate(bandId)
      setSelectedId(created.id)
      toast.success(text.created)
    },
    onError: (error) =>
      toast.error(t('Vertrag konnte nicht angelegt werden'), { description: error.message })
  })

  if (agreements.isLoading) {
    return <p className="text-sm text-muted-foreground">{t('Verträge werden geladen…')}</p>
  }

  return (
    <div className="space-y-5">
      <TabHeader
        summary={selected ? countLabel(list.length, t('Vertrag'), t('Verträge')) : text.empty}
      >
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => createMutation.mutate({ bandId, kind })}
          disabled={createMutation.isPending}
          title={selected ? t('Neuer Vertrag mit den Konditionen des aktuellen') : undefined}
        >
          <Plus className="h-4 w-4" />
          {t('Neuer Vertrag')}
        </Button>
      </TabHeader>

      {selected && (
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
                {list.map((agreement, index) => (
                  <SelectItem key={agreement.id} value={String(agreement.id)}>
                    {agreementLabel(agreement, index === 0)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Separator />
          <AgreementForm
            key={selected.id}
            bandId={bandId}
            agreement={selected}
            counterparty={text.counterparty}
            onDeleted={() => setSelectedId(null)}
          />
        </div>
      )}
    </div>
  )
}

// ========================================
// Form
// ========================================

type Terms = PublishingTerms | LabelTerms

function AgreementForm({
  bandId,
  agreement,
  counterparty,
  onDeleted
}: {
  bandId: number
  agreement: BandAgreementDto
  counterparty: string
  onDeleted: () => void
}) {
  const navigate = useNavigate()
  const utils = trpcReact.useUtils()
  const companies = trpcReact.company.getListItems.useQuery()
  const [companyId, setCompanyId] = useState(agreement.companyId)
  const [startDate, setStartDate] = useState(agreement.startDate ?? '')
  const [specialClauses, setSpecialClauses] = useState(agreement.specialClauses)
  const [terms, setTerms] = useState<Terms>(agreement.terms)
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  const [dirty, setDirty] = useState(false)
  useReportUnsavedChanges(dirty)

  const touch = () => setDirty(true)
  const setTerm = (key: string, value: unknown) => {
    setTerms((prev) => ({ ...prev, [key]: value }) as Terms)
    touch()
  }
  const markInvalid = (key: string, bad: boolean) =>
    setInvalid((prev) => {
      const next = new Set(prev)
      if (bad) next.add(key)
      else next.delete(key)
      return next
    })

  const updateMutation = trpcReact.bandAgreement.update.useMutation()
  const deleteMutation = trpcReact.bandAgreement.delete.useMutation({
    onSuccess: () => {
      void utils.bandAgreement.listByBand.invalidate(bandId)
      onDeleted()
      toast.success(t('Vertrag gelöscht'))
    },
    onError: (error) =>
      toast.error(t('Vertrag konnte nicht gelöscht werden'), { description: error.message })
  })

  const save = async (): Promise<boolean> => {
    if (invalid.size > 0) {
      toast.error(t('Bitte Eingaben prüfen'), {
        description: t('Mindestens eine Zahl ist ungültig.')
      })
      return false
    }
    try {
      await updateMutation.mutateAsync({
        id: agreement.id,
        companyId,
        startDate: startDate || null,
        specialClauses,
        terms: terms as Record<string, unknown>
      })
      await utils.bandAgreement.listByBand.invalidate(bandId)
      setDirty(false)
      return true
    } catch (error) {
      toast.error(t('Vertrag konnte nicht gespeichert werden'), {
        description: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  const fields: FieldKit = { terms, setTerm, markInvalid }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ba-company">{counterparty}</Label>
          <SearchableSelect
            id="ba-company"
            value={companyId || null}
            onChange={(value) => {
              setCompanyId(value)
              touch()
            }}
            options={(companies.data ?? []).map((company) => ({
              value: company.id,
              label: company.name
            }))}
            placeholder={t('Firma auswählen')}
            searchPlaceholder={t('Firma suchen…')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ba-start">{t('Vertragsbeginn')}</Label>
          <Input
            id="ba-start"
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value)
              touch()
            }}
          />
          <p className="text-xs text-muted-foreground">
            {t('Datum der Letztunterschrift, sobald bekannt')}
          </p>
        </div>
      </div>

      {agreement.kind === 'publishing' ? (
        <PublishingFields {...fields} terms={terms as PublishingTerms} />
      ) : (
        <LabelFields {...fields} terms={terms as LabelTerms} />
      )}

      <div className="space-y-2">
        <Label htmlFor="ba-special">{t('Sondervereinbarungen')}</Label>
        <Textarea
          id="ba-special"
          rows={3}
          value={specialClauses}
          onChange={(e) => {
            setSpecialClauses(e.target.value)
            touch()
          }}
          placeholder={t('Erscheint als eigener Abschnitt am Vertragsende')}
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
              deleteMutation.mutate(agreement.id)
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
                to: '/band-agreements/$agreementId/print',
                params: { agreementId: String(agreement.id) }
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

// ========================================
// Field building blocks
// ========================================

type FieldKit = {
  terms: Terms
  setTerm: (key: string, value: unknown) => void
  markInvalid: (key: string, bad: boolean) => void
}

function Field({
  id,
  label,
  hint,
  children
}: {
  id?: string
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/**
 * A number edited as text: reports the parsed value while it is valid, null when emptied (only
 * where `optional`), and marks itself invalid otherwise
 */
function NumberInput({
  id,
  value,
  onChange,
  onInvalid,
  optional = false,
  max,
  suffix
}: {
  id: string
  value: number | null
  onChange: (value: number | null) => void
  onInvalid: (bad: boolean) => void
  optional?: boolean
  max?: number
  suffix?: string
}) {
  const [text, setText] = useState(value === null ? '' : String(value).replace('.', ','))
  const [bad, setBad] = useState(false)
  const update = (next: string) => {
    setText(next)
    const trimmed = next.trim()
    let parsed: number | null
    if (trimmed === '') parsed = optional ? null : NaN
    else parsed = Number(trimmed.replace(/\./g, '').replace(',', '.'))
    const isBad =
      parsed !== null &&
      (!Number.isFinite(parsed) || parsed < 0 || (max !== undefined && parsed > max))
    setBad(isBad)
    onInvalid(isBad)
    if (!isBad) onChange(parsed)
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        inputMode="decimal"
        value={text}
        aria-invalid={bad || undefined}
        className={bad ? 'border-destructive' : undefined}
        onChange={(e) => update(e.target.value)}
      />
      {suffix && <span className="shrink-0 text-sm text-muted-foreground">{suffix}</span>}
    </div>
  )
}

/** Renders a number field of the terms (a plain helper, not a hook or component) */
function numberFields(kit: FieldKit) {
  return function numberField(
    key: string,
    label: string,
    options: { suffix?: string; optional?: boolean; max?: number; hint?: string } = {}
  ) {
    return (
      <Field id={`ba-${key}`} label={label} hint={options.hint}>
        <NumberInput
          id={`ba-${key}`}
          value={(kit.terms as Record<string, unknown>)[key] as number | null}
          onChange={(value) => kit.setTerm(key, value)}
          onInvalid={(bad) => kit.markInvalid(key, bad)}
          optional={options.optional}
          max={options.max}
          suffix={options.suffix}
        />
      </Field>
    )
  }
}

/** Renders a text field of the terms (a plain helper, not a hook or component) */
function textFields(kit: FieldKit) {
  return function textField(
    key: string,
    label: string,
    options: { rows?: number; hint?: string; type?: string } = {}
  ) {
    return (
      <Field id={`ba-${key}`} label={label} hint={options.hint}>
        {options.rows ? (
          <Textarea
            id={`ba-${key}`}
            rows={options.rows}
            value={String((kit.terms as Record<string, unknown>)[key] ?? '')}
            onChange={(e) => kit.setTerm(key, e.target.value)}
          />
        ) : (
          <Input
            id={`ba-${key}`}
            type={options.type}
            value={String((kit.terms as Record<string, unknown>)[key] ?? '')}
            onChange={(e) => kit.setTerm(key, e.target.value)}
          />
        )}
      </Field>
    )
  }
}

function Check({
  id,
  checked,
  onChange,
  children
}: {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <input
        id={id}
        type="checkbox"
        className="h-4 w-4 accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  )
}

// ========================================
// Publishing contract
// ========================================

function PublishingFields(kit: FieldKit & { terms: PublishingTerms }) {
  const { terms, setTerm } = kit
  const number = numberFields(kit)
  const text = textFields(kit)

  const setWork = (index: number, key: string, value: string) =>
    setTerm(
      'works',
      terms.works.map((work, i) => (i === index ? { ...work, [key]: value } : work))
    )

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {text('authorGemaNumber', t('GEMA-Mitgliedsnummer des Autors'))}
        {text('publisherImprint', t('Verlagsbezeichnung bei der GEMA'), {
          hint: t('Leer: der Name des Verlags')
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field id="ba-rightsTerm" label={t('Dauer der Rechteeinräumung')}>
          <Select value={terms.rightsTerm} onValueChange={(value) => setTerm('rightsTerm', value)}>
            <SelectTrigger id="ba-rightsTerm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="statutory">{t('Gesetzliche Schutzfrist')}</SelectItem>
              <SelectItem value="years">{t('Jahre ab Erstveröffentlichung')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {terms.rightsTerm === 'years' && number('rightsYears', t('Jahre'), { suffix: t('Jahre') })}
        <Field id="ba-unknownUses" label={t('Unbekannte Nutzungsarten')}>
          <Select
            value={terms.unknownUses}
            onValueChange={(value) => setTerm('unknownUses', value)}
          >
            <SelectTrigger id="ba-unknownUses">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="proportional">{t('Vergütung wie in diesem Vertrag')}</SelectItem>
              <SelectItem value="market">{t('Später zu Marktbedingungen')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {number('printSinglePercent', t('Notendruck Einzelausgaben'), { suffix: '%', max: 100 })}
        {number('printAlbumPercent', t('Notendruck Alben'), { suffix: '%', max: 100 })}
        {number('otherLicensePercent', t('Sonstige Lizenzen'), { suffix: '%', max: 100 })}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {text('statementEmail', t('E-Mail für Abrechnungen'), {
          type: 'email',
          hint: t('Leer: die E-Mail der Bandfirma')
        })}
        {number('confidentialityYears', t('Verschwiegenheit nach Vertragsende'), {
          suffix: t('Jahre')
        })}
      </div>

      <div className="space-y-2">
        <Label>{t('Vertragsgegenständliche Werke (Anlage A)')}</Label>
        {terms.works.map((work, index) => (
          <div key={index} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2">
            <Input
              aria-label={t('Werktitel')}
              placeholder={t('Werktitel')}
              value={work.title}
              onChange={(e) => setWork(index, 'title', e.target.value)}
            />
            <Input
              aria-label={t('Komponist')}
              placeholder={t('Komponist')}
              value={work.composer}
              onChange={(e) => setWork(index, 'composer', e.target.value)}
            />
            <Input
              aria-label={t('Texter')}
              placeholder={t('Texter')}
              value={work.lyricist}
              onChange={(e) => setWork(index, 'lyricist', e.target.value)}
            />
            <Input
              aria-label={t('Verlagsanteil')}
              placeholder={t('Verlagsanteil')}
              value={work.publisherShare}
              onChange={(e) => setWork(index, 'publisherShare', e.target.value)}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('Werk entfernen')}
              onClick={() =>
                setTerm(
                  'works',
                  terms.works.filter((_, i) => i !== index)
                )
              }
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() =>
            setTerm('works', [
              ...terms.works,
              { title: '', composer: '', lyricist: '', publisherShare: '' }
            ])
          }
        >
          <Plus className="h-4 w-4" /> {t('Werk hinzufügen')}
        </Button>
      </div>

      <Separator />

      <Check
        id="ba-exclusive"
        checked={terms.exclusive}
        onChange={(checked) => setTerm('exclusive', checked)}
      >
        {t('Exklusive Vertragsdauer (Anlage B): alle Werke der Laufzeit, Optionen, Vorschuss')}
      </Check>

      {terms.exclusive && (
        <div className="space-y-4 rounded-md border p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field id="ba-exclusiveStart" label={t('Beginn')}>
              <Input
                id="ba-exclusiveStart"
                type="date"
                value={terms.exclusiveStart ?? ''}
                onChange={(e) => setTerm('exclusiveStart', e.target.value || null)}
              />
            </Field>
            <Field id="ba-exclusiveEnd" label={t('Ende (Mindestdauer)')}>
              <Input
                id="ba-exclusiveEnd"
                type="date"
                value={terms.exclusiveEnd ?? ''}
                onChange={(e) => setTerm('exclusiveEnd', e.target.value || null)}
              />
            </Field>
            {number('options', t('Optionen um je ein Jahr'))}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {number('advance', t('Vorschuss (Darlehen)'), { suffix: 'EUR', optional: true })}
            {number('rollingAdvance', t('Rolling Advance'), { suffix: 'EUR', optional: true })}
          </div>
          {terms.options > 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {number('optionAdvancePercent', t('Vorschuss je Option'), {
                suffix: t('% der GEMA-Einnahmen'),
                optional: true,
                max: 100
              })}
              {number('optionAdvanceMin', t('mindestens'), { suffix: 'EUR', optional: true })}
              {number('optionAdvanceMax', t('höchstens'), { suffix: 'EUR', optional: true })}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {number('minWorksTerm', t('Mindestens neue Werke (Laufzeit)'), { optional: true })}
            {number('minWorksOption', t('Mindestens neue Werke (je Option)'), { optional: true })}
            {number('refundPercent', t('Refundierung'), {
              suffix: t('% des Verlagsanteils'),
              optional: true,
              max: 100
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('Leere Felder lassen den jeweiligen Absatz im Vertrag weg.')}
          </p>
        </div>
      )}
    </div>
  )
}

// ========================================
// Label head of agreement
// ========================================

function TierEditor({
  name,
  label,
  tiers,
  fromLabel,
  valueLabel,
  valueSuffix,
  onChange,
  onInvalid
}: {
  /** Prefix of the inputs' ids */
  name: string
  label: string
  tiers: Array<{ from: number; value: number }>
  fromLabel: string
  valueLabel: string
  valueSuffix: string
  onChange: (tiers: Array<{ from: number; value: number }>) => void
  onInvalid: (key: string, bad: boolean) => void
}) {
  // Rows are keyed by position; a removed row re-mounts the ones after it
  const [version, setVersion] = useState(0)
  const set = (index: number, patch: Partial<{ from: number; value: number }>) =>
    onChange(tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)))
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {tiers.map((tier, index) => (
        <div key={`${version}-${index}`} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <Field id={`ba-${name}-${index}-from`} label={fromLabel}>
            <NumberInput
              id={`ba-${name}-${index}-from`}
              value={tier.from}
              onChange={(value) => set(index, { from: value ?? 0 })}
              onInvalid={(bad) => onInvalid(`${name}-${index}-from`, bad)}
            />
          </Field>
          <Field id={`ba-${name}-${index}-value`} label={valueLabel}>
            <NumberInput
              id={`ba-${name}-${index}-value`}
              value={tier.value}
              suffix={valueSuffix}
              max={valueSuffix === '%' ? 100 : undefined}
              onChange={(value) => set(index, { value: value ?? 0 })}
              onInvalid={(bad) => onInvalid(`${name}-${index}-value`, bad)}
            />
          </Field>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('Stufe entfernen')}
            onClick={() => {
              onChange(tiers.filter((_, i) => i !== index))
              setVersion((v) => v + 1)
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => {
          const last = tiers[tiers.length - 1]
          onChange([...tiers, { from: last ? last.from + 1 : 0, value: last?.value ?? 0 }])
        }}
      >
        <Plus className="h-4 w-4" /> {t('Stufe hinzufügen')}
      </Button>
    </div>
  )
}

function LabelFields(kit: FieldKit & { terms: LabelTerms }) {
  const { terms, setTerm, markInvalid } = kit
  const number = numberFields(kit)
  const text = textFields(kit)
  const royalties = (tiers: LabelRoyaltyTier[]) =>
    tiers.map((tier) => ({ from: tier.from, value: tier.percent }))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {text('rights', t('Rechte'))}
        {text('territory', t('Gebiet'))}
        {text('titleExclusivity', t('Titelexklusivität'), {
          hint: t('z.B. 15 Jahre nach Veröffentlichung des letzten Optionsalbums')
        })}
        {text('exploitationTime', t('Auswertungsdauer'))}
      </div>
      {text('term', t('Vertragsumfang'), { rows: 2 })}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {number('albumOptions', t('Album-Optionen'))}
        {number('sublicensingPercent', t('Sublizenzierung'), { suffix: '%', max: 100 })}
        {number('returnsReservePercent', t('Retourenreserve'), { suffix: '%', max: 100 })}
        {number('accountingMonths', t('Abrechnung alle'), { suffix: t('Monate') })}
        {number('accountingDays', t('Zahlung innerhalb'), { suffix: t('Tage') })}
      </div>

      <TierEditor
        name="optionAdvances"
        label={t('Vorschuss für Optionsalben')}
        tiers={terms.optionAdvances.map((tier) => ({ from: tier.fromCopies, value: tier.amount }))}
        fromLabel={t('ab verkauften Exemplaren des Vorgängers')}
        valueLabel={t('Vorschuss')}
        valueSuffix="EUR"
        onChange={(tiers) =>
          setTerm(
            'optionAdvances',
            tiers.map((tier) => ({ fromCopies: tier.from, amount: tier.value }))
          )
        }
        onInvalid={markInvalid}
      />
      <TierEditor
        name="physicalRoyalties"
        label={t('Lizenzsatz physische Verkäufe')}
        tiers={royalties(terms.physicalRoyalties)}
        fromLabel={t('ab verkauften Alben (0 = von Anfang an)')}
        valueLabel={t('Satz vom Netto-ARP')}
        valueSuffix="%"
        onChange={(tiers) =>
          setTerm(
            'physicalRoyalties',
            tiers.map((tier) => ({ from: tier.from, percent: tier.value }))
          )
        }
        onInvalid={markInvalid}
      />
      <TierEditor
        name="digitalRoyalties"
        label={t('Lizenzsatz digitale Verkäufe')}
        tiers={royalties(terms.digitalRoyalties)}
        fromLabel={t('ab Album-Streams (0 = von Anfang an)')}
        valueLabel={t('Satz vom Netto-ARP')}
        valueSuffix="%"
        onChange={(tiers) =>
          setTerm(
            'digitalRoyalties',
            tiers.map((tier) => ({ from: tier.from, percent: tier.value }))
          )
        }
        onInvalid={markInvalid}
      />

      {text('packagingDeduction', t('Verpackungsabzug'), { rows: 2 })}
      {text('freeCopies', t('Freiexemplare'), { rows: 2 })}
      {text('artistPrices', t('Preise für CD/Vinyl (Bandkauf)'), {
        rows: 3,
        hint: t('Eine Zeile je Format; leer: kein Abschnitt im Vertrag')
      })}
      {text('merchandise', t('Optionales Merchandise'), {
        rows: 2,
        hint: t('Leer: kein Abschnitt im Vertrag')
      })}
      <div className="space-y-2">
        <Check
          id="ba-offerOnlineStore"
          checked={terms.offerOnlineStore}
          onChange={(checked) => setTerm('offerOnlineStore', checked)}
        >
          {t('Shop-Deal über das Label anbieten')}
        </Check>
        <Check
          id="ba-offerPublishing"
          checked={terms.offerPublishing}
          onChange={(checked) => setTerm('offerPublishing', checked)}
        >
          {t('Verlagsdeal über das Label anbieten')}
        </Check>
      </div>
    </div>
  )
}
