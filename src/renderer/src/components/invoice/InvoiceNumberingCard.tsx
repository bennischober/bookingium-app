import { SearchableSelect } from '@/components/ui/searchable-select'
import { useState } from 'react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { InvoiceNumberFormat } from '../../../../main/api/schemas/invoice.schema'
import { previewNumber } from '../../../../main/invoice/numbering'
import { t } from '../../../../main/i18n/translate'

const FORMAT_LABELS: Record<InvoiceNumberFormat, string> = {
  plain: t('Fortlaufend (1040, 1041, …)'),
  year: 'Jahr + laufende Nummer (2026813, …)'
}

type Draft = { next: string; format: InvoiceNumberFormat; digits: string; yearlyReset: boolean }

/**
 * How the issuing company numbers its invoices (Einstellungen › Rechnungen): the next running
 * number, plain or with the year in front, and whether the running number starts at 1 each
 * year. When invoices move over from DATEV, the next number continues DATEV's last one.
 */
export function InvoiceNumberingCard() {
  const utils = trpcReact.useUtils()
  const [settingsCompanyId, setSettingsCompanyId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft>({
    next: '1',
    format: 'plain',
    digits: '3',
    yearlyReset: false
  })

  const companies = trpcReact.company.getListItems.useQuery()
  const defaultCompany = trpcReact.company.getDefaultForInvoicing.useQuery()

  // Default to the default invoicing company once known (state adjustment
  // during render, per "You Might Not Need an Effect")
  const [lastDefaultCompanyId, setLastDefaultCompanyId] = useState<number | null | undefined>(
    defaultCompany.data?.id
  )
  if (settingsCompanyId === null && defaultCompany.data?.id !== lastDefaultCompanyId) {
    setLastDefaultCompanyId(defaultCompany.data?.id)
    if (defaultCompany.data?.id) {
      setSettingsCompanyId(defaultCompany.data.id)
    }
  }

  const settingsQuery = trpcReact.invoice.getCompanySettings.useQuery(settingsCompanyId ?? 0, {
    enabled: settingsCompanyId !== null
  })

  // Keep the inputs following the loaded settings
  const [lastLoaded, setLastLoaded] = useState(settingsQuery.data)
  if (settingsQuery.data !== lastLoaded) {
    setLastLoaded(settingsQuery.data)
    const loaded = settingsQuery.data
    setDraft({
      next: String(loaded?.nextInvoiceNumber ?? 1),
      format: loaded?.numberFormat ?? 'plain',
      digits: String(loaded?.numberDigits ?? 3),
      yearlyReset: loaded?.numberYearlyReset ?? false
    })
  }

  const numberMutation = trpcReact.invoice.upsertCompanySettings.useMutation()
  const formatMutation = trpcReact.invoice.setNumbering.useMutation()
  const saving = numberMutation.isPending || formatMutation.isPending

  const next = Number(draft.next)
  const digits = Number(draft.digits)
  const valid =
    Number.isInteger(next) && next >= 1 && Number.isInteger(digits) && digits >= 1 && digits <= 9
  const preview = valid
    ? previewNumber(
        {
          format: draft.format,
          digits,
          yearlyReset: draft.yearlyReset,
          next,
          lastYear: settingsQuery.data?.numberYear ?? null
        },
        new Date().getFullYear()
      )
    : null

  const handleSave = async () => {
    if (settingsCompanyId === null) {
      toast.error(t('Bitte zuerst eine Firma auswählen'))
      return
    }
    if (!valid) {
      toast.error(t('Nächste Nummer muss eine ganze Zahl ≥ 1 sein, die Stellen 1 bis 9'))
      return
    }
    try {
      await formatMutation.mutateAsync({
        companyId: settingsCompanyId,
        format: draft.format,
        digits,
        yearlyReset: draft.yearlyReset
      })
      await numberMutation.mutateAsync({ companyId: settingsCompanyId, nextInvoiceNumber: next })
      await utils.invoice.getCompanySettings.invalidate(settingsCompanyId)
      toast.success(t('Rechnungsnummerierung aktualisiert'))
    } catch (error) {
      toast.error(t('Einstellungen konnten nicht aktualisiert werden'), {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  const disabled = settingsCompanyId === null || settingsQuery.isLoading

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Rechnungsnummerierung')}</CardTitle>
        <CardDescription>
          {t(
            'Wie die gestellten Rechnungen der gewählten Firma nummeriert werden. Beim Wechsel von DATEV hier die Nummer eintragen, die auf DATEVs letzte Rechnung folgt. Das Rechnungsdatum kann nicht vor dem der letzten gestellten Rechnung liegen.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-2">
            <Label htmlFor="numbering-company">{t('Firma')}</Label>
            <SearchableSelect
              id="numbering-company"
              value={settingsCompanyId}
              onChange={(value) => value !== null && setSettingsCompanyId(value)}
              options={(companies.data ?? []).map((company) => ({
                value: company.id,
                label: company.name
              }))}
              placeholder={t('Firma auswählen')}
              searchPlaceholder={t('Firma suchen…')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="numbering-format">{t('Format')}</Label>
            <Select
              value={draft.format}
              onValueChange={(value) =>
                setDraft({ ...draft, format: value as InvoiceNumberFormat })
              }
              disabled={disabled}
            >
              <SelectTrigger id="numbering-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FORMAT_LABELS) as InvoiceNumberFormat[]).map((format) => (
                  <SelectItem key={format} value={format}>
                    {FORMAT_LABELS[format]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[12rem_8rem_minmax(0,1fr)_auto]">
          <div className="space-y-2">
            <Label htmlFor="numbering-next">
              {draft.format === 'year'
                ? t('Nächste laufende Nummer')
                : t('Nächste Rechnungsnummer')}
            </Label>
            <Input
              id="numbering-next"
              type="number"
              min="1"
              step="1"
              value={draft.next}
              onChange={(e) => setDraft({ ...draft, next: e.target.value })}
              disabled={disabled}
            />
          </div>
          {draft.format === 'year' ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="numbering-digits">{t('Stellen')}</Label>
                <Input
                  id="numbering-digits"
                  type="number"
                  min="1"
                  max="9"
                  step="1"
                  value={draft.digits}
                  onChange={(e) => setDraft({ ...draft, digits: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="flex h-9 items-center gap-2">
                <Switch
                  id="numbering-yearly-reset"
                  checked={draft.yearlyReset}
                  onCheckedChange={(checked) => setDraft({ ...draft, yearlyReset: checked })}
                  disabled={disabled}
                />
                <Label htmlFor="numbering-yearly-reset">{t('Jedes Jahr bei 1 beginnen')}</Label>
              </div>
            </>
          ) : (
            <>
              <div />
              <div />
            </>
          )}
          <Button onClick={() => void handleSave()} disabled={saving || disabled}>
            {t('Speichern')}
          </Button>
        </div>

        <p className="text-sm text-muted-foreground" aria-live="polite">
          {preview !== null
            ? t('Die nächste gestellte Rechnung erhält die Nummer {{preview}}.', { preview })
            : t('Bitte gültige Werte eintragen.')}
        </p>
      </CardContent>
    </Card>
  )
}
