import { CircleAlert, Info } from 'lucide-react'
import type { InvoicePrintDto } from '../../../../main/api/schemas/invoice.schema'
import { foreignRecipientHint } from '../../../../main/invoice/taxSummary'
import { Button } from '@/components/ui/button'
import type { DocumentLang } from '../print/DocumentLanguageSelect'
import { t } from '../../../../main/i18n/translate'

/**
 * Print page note for invoices abroad: suggests English and the tax code that usually
 * fits, and warns when reverse charge lacks the buyer's VAT ID. Only a hint: nothing is
 * changed by it, and which tax code applies is the tax advisor's call.
 */
export function ForeignRecipientHint({
  data,
  lang,
  suggestedLang,
  onUseLang
}: {
  data: InvoicePrintDto
  lang: DocumentLang
  suggestedLang: DocumentLang
  onUseLang: (lang: DocumentLang) => void
}) {
  const hint = foreignRecipientHint(data)
  if (!hint) return null

  const country = data.recipient?.country || hint.countryCode || t('Ausland')
  const draft = data.invoice.status === 'draft'
  const lines: string[] = []
  if (hint.situation === 'eu_vat_id' && hint.chargesGermanVat) {
    lines.push(
      t(
        'Firma in der EU mit USt-IdNr.: Üblich ist der Steuerschlüssel „Reverse Charge“ statt deutscher USt.'
      )
    )
  }
  if (hint.situation === 'non_eu' && hint.chargesGermanVat) {
    lines.push(
      t(
        'Empfänger außerhalb der EU: Üblich ist der Steuerschlüssel „nicht steuerbar“ statt deutscher USt.'
      )
    )
  }
  if (hint.situation === 'eu_no_vat_id' && !hint.missingVatId) {
    lines.push(
      t(
        'Empfänger in der EU ohne USt-IdNr.: Für „Reverse Charge“ braucht es die USt-IdNr. des Empfängers.'
      )
    )
  }
  const showLang = suggestedLang === 'en' && lang !== 'en'
  if (!hint.missingVatId && lines.length === 0 && !showLang) return null

  return (
    <div
      role="status"
      aria-label={t('Hinweis zur Rechnung ins Ausland')}
      className="space-y-2 rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100"
    >
      <p className="flex items-center gap-2 font-medium">
        <Info className="h-4 w-4 shrink-0" /> {t('Rechnung ins Ausland (')}
        {country})
      </p>
      {hint.missingVatId && (
        <p className="flex items-start gap-2 font-medium text-amber-900 dark:text-amber-200">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {t(
            '„Reverse Charge“ ist gewählt, aber beim Empfänger fehlt die USt-IdNr. Sie gehört auf die Rechnung.'
          )}
        </p>
      )}
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {showLang && (
        <p className="flex flex-wrap items-center gap-2">
          {t('Für diesen Empfänger bietet sich eine englische Rechnung an.')}
          <Button size="sm" variant="outline" onClick={() => onUseLang('en')}>
            {t('Englisch verwenden')}
          </Button>
        </p>
      )}
      <p className="text-xs">
        {t(
          'Nur ein Hinweis, die App ändert nichts selbst. Welcher Steuerschlüssel gilt, entscheidet Ihr Steuerberater.'
        )}{' '}
        {draft
          ? t('Den Steuerschlüssel ändern Sie je Position unter „Bearbeiten“.')
          : t('Eine gestellte Rechnung ändern Sie per Storno und neuer Rechnung.')}
      </p>
    </div>
  )
}
