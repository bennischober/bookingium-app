import { Plus } from 'lucide-react'
import type { InvoiceLineEditor } from '@/hooks/useInvoiceLineEditor'
import { formatMoney } from '@/lib/invoiceLabels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { lineAmounts, type InvoiceLineDraft } from '@/components/invoice/invoiceFormState'
import type { InvoiceTaxCode } from '../../../../main/api/schemas/invoice.schema'
import { INVOICE_UNITS, TAX_CODES, unitLabelOf } from '../../../../main/einvoice/codes'
import { t } from '../../../../main/i18n/translate'

// #254: the tax codes in the UI language. TAX_CODE_LABELS (einvoice/codes.ts) stays German:
// it is printed on German invoices whatever the UI language is.
const TAX_CODE_UI_LABELS: Record<InvoiceTaxCode, string> = {
  standard: t('Regelsatz'),
  reduced: t('ermäßigt'),
  zero_rated: t('Nullsatz'),
  reverse_charge: t('Reverse Charge'),
  exempt: t('steuerfrei'),
  intra_community: t('innergemeinschaftliche Lieferung'),
  export: t('Ausfuhr (Drittland)'),
  not_taxable: t('nicht steuerbar'),
  other: t('sonstig')
}

/**
 * The invoice's line items as cards, and one editor below them that adds a
 * line or changes the one picked with "Bearbeiten".
 */
export function InvoiceLineItems({
  lines,
  editor,
  currency
}: {
  lines: InvoiceLineDraft[]
  editor: InvoiceLineEditor
  currency: string
}) {
  const { editingIndex, line: draft, setField } = editor

  return (
    <>
      <div className="flex items-center justify-between">
        <Label>{t('Positionen')}</Label>
        <Button type="button" variant="outline" size="sm" onClick={editor.reset}>
          <Plus className="h-4 w-4 mr-1" />
          {t('Position hinzufügen')}
        </Button>
      </div>

      <div className="space-y-2">
        {lines.map((line, index) => {
          const { quantity, unitPrice, taxRate, net, gross } = lineAmounts(line)
          return (
            <div
              key={`line-card-${index}`}
              className="border rounded-md p-3 flex items-start justify-between gap-3"
            >
              <div>
                <p className="font-medium text-sm">{line.description || t('Ohne Bezeichnung')}</p>
                <p className="text-xs text-muted-foreground">
                  {quantity} {unitLabelOf(line.unit)} x {formatMoney(unitPrice, currency)} (
                  {taxRate}
                  {t('% MwSt.,')} {TAX_CODE_UI_LABELS[line.taxCode]})
                </p>
                <p className="text-xs mt-1">
                  {t('Netto')} {formatMoney(net, currency)} {t('· Brutto')}{' '}
                  {formatMoney(gross, currency)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => editor.openEdit(index)}
                >
                  {t('Bearbeiten')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => editor.remove(index)}
                >
                  {t('Entfernen')}
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="border rounded-md p-3 space-y-3">
        <p className="text-sm font-medium">
          {editingIndex === null
            ? t('Position hinzufügen')
            : t('Position #{{value}} bearbeiten', { value: editingIndex + 1 })}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1 md:col-span-2">
            <Label>{t('Beschreibung')}</Label>
            <Input
              value={draft.description}
              onChange={(e) => setField({ description: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('Menge')}</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={draft.quantity}
              onChange={(e) => setField({ quantity: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invoice-line-unit">{t('Einheit')}</Label>
            <Select value={draft.unit} onValueChange={(value) => setField({ unit: value })}>
              <SelectTrigger id="invoice-line-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVOICE_UNITS.map((unit) => (
                  <SelectItem key={unit.value} value={unit.value}>
                    {unit.label}
                  </SelectItem>
                ))}
                {/* Free-text unit of an older invoice stays selectable */}
                {!INVOICE_UNITS.some((unit) => unit.value === draft.unit) && (
                  <SelectItem value={draft.unit}>{draft.unit}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t('Netto-Einzelpreis')}</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={draft.unitPriceNet}
              onChange={(e) => setField({ unitPriceNet: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('MwSt. %')}</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={draft.taxRate}
              onChange={(e) => setField({ taxRate: e.target.value })}
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>{t('Steuerschlüssel')}</Label>
            <Select
              value={draft.taxCode}
              onValueChange={(value) => setField({ taxCode: value as InvoiceTaxCode })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TAX_CODES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {TAX_CODE_UI_LABELS[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={editor.reset}>
            {t('Zurücksetzen')}
          </Button>
          <Button type="button" onClick={editor.save}>
            {editingIndex === null ? t('Position hinzufügen') : t('Position speichern')}
          </Button>
        </div>
      </div>
    </>
  )
}
