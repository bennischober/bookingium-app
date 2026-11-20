// What the own company still lacks for an invoice, in a pure module so vitest can hold it. The
// e-invoice check (einvoice/prepare.ts) is the authority when an invoice is issued; this only
// says in Einstellungen what is worth filling in before, in the words of the company form.
import type { CompanyDto } from '../../../../main/api/schemas/company.schema'
import { t } from '../../../../main/i18n/translate'

const blank = (value: string | null | undefined): boolean => !value || value.trim() === ''

/** The missing parts that every invoice prints or the e-invoice needs, in form order */
export function ownCompanyGaps(company: CompanyDto): string[] {
  const gaps: string[] = []
  const address = company.address
  if (!address || blank(address.street) || blank(address.zipCode) || blank(address.city)) {
    gaps.push(t('Adresse (Straße, PLZ, Ort)'))
  }
  if (blank(company.contact?.email)) gaps.push('E-Mail')
  if (blank(company.vatId) && blank(company.taxNumber)) gaps.push(t('USt-IdNr. oder Steuernummer'))
  if (blank(company.bank?.iban)) gaps.push(t('Bankverbindung mit IBAN'))
  return gaps
}
