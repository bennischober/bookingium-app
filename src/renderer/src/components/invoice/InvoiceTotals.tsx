import { formatMoney } from '@/lib/invoiceLabels'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { computeTotals } from '@/components/invoice/invoiceFormState'
import { t } from '../../../../main/i18n/translate'

/** Net, tax and gross of the lines as the invoice will store them (read-only) */
export function InvoiceTotals({
  totals,
  currency
}: {
  totals: ReturnType<typeof computeTotals>
  currency: string
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="space-y-2">
        <Label>{t('Zwischensumme netto')}</Label>
        <Input value={formatMoney(totals.subtotalNetAmount, currency)} readOnly />
      </div>
      <div className="space-y-2">
        <Label>{t('Steuerbetrag')}</Label>
        <Input value={formatMoney(totals.subtotalTaxAmount, currency)} readOnly />
      </div>
      <div className="space-y-2">
        <Label>{t('Gesamt brutto')}</Label>
        <Input value={formatMoney(totals.totalGrossAmount, currency)} readOnly />
      </div>
    </div>
  )
}
