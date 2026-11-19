// #236: what the text of a plain PDF invoice says about its sender - IBAN (checked), BIC,
// USt-IdNr., Steuernummer, e-mail, phone, postcode and place. Pure; every value is a candidate
// the caller filters (an invoice names the recipient too) and the user confirms.

export type InvoiceTextFacts = {
  ibans: string[]
  bics: string[]
  vatIds: string[]
  taxNumbers: string[]
  emails: string[]
  phones: string[]
  /** "Musterstraße 1, 50667 Köln" lines: street, number, postcode, place */
  addresses: Array<{ street: string; streetNumber: string; zipCode: string; city: string }>
}

const unique = (values: string[]): string[] => [...new Set(values)]

/** An IBAN whose check digits add up (ISO 13616, mod 97) */
export function validIban(raw: string): boolean {
  const iban = raw.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false
  const moved = iban.slice(4) + iban.slice(0, 4)
  let rest = 0
  for (const char of moved) {
    const value = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55)
    for (const digit of value) rest = (rest * 10 + Number(digit)) % 97
  }
  return rest === 1
}

/** "DE89 3704 0044 0532 0130 00" in groups of four */
export const formatIban = (iban: string): string =>
  iban
    .replace(/\s/g, '')
    .toUpperCase()
    .replace(/(.{4})/g, '$1 ')
    .trim()

export function readInvoiceText(text: string): InvoiceTextFacts {
  const flat = text.replace(/\u00a0/g, ' ')

  const ibans = unique(
    [...flat.matchAll(/\b([A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?)\b/g)]
      .map((match) => match[1].replace(/\s/g, ''))
      .filter(validIban)
  )

  const bics = unique(
    [
      ...flat.matchAll(
        /\b(?:BIC|SWIFT)(?:[- ]?Code)?\s*:?\s*([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/gi
      )
    ].map((match) => match[1].toUpperCase())
  )

  // EU VAT ids: country code and 8-12 characters ("DE123456789", "ATU12345678")
  const vatIds = unique(
    [
      ...flat.matchAll(
        /\b(DE\s?\d{3}\s?\d{3}\s?\d{3}|AT\s?U\d{8}|CH[EF]?-?\d{3}\.?\d{3}\.?\d{3}(?:\s?MWST)?|[A-Z]{2}\d{8,12})\b/g
      )
    ]
      .map((match) => match[1].replace(/\s/g, ''))
      // a German IBAN starts like a VAT id; IBANs are longer
      .filter((value) => !ibans.some((iban) => iban.startsWith(value)))
  )

  const taxNumbers = unique(
    [
      ...flat.matchAll(
        /\b(?:St(?:euer)?[.-]{0,2}\s?(?:Nr|Nummer)\.?|Steuernummer)\s*:?\s*(\d{2,3}\s?\/\s?\d{3,4}\s?\/\s?\d{4,5})/gi
      )
    ].map((match) => match[1].replace(/\s/g, ''))
  )

  const emails = unique(
    [...flat.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)].map(
      (match) => match[0].toLowerCase()
    )
  )

  const phones = unique(
    [...flat.matchAll(/\b(?:Tel(?:efon)?|Phone|Fon)\.?\s*:?\s*(\+?[\d][\d /()-]{5,}\d)/gi)].map(
      (match) => match[1].replace(/\s+/g, ' ').trim()
    )
  )

  const addresses: InvoiceTextFacts['addresses'] = []
  for (const match of flat.matchAll(
    /([A-ZÄÖÜ][\p{L}ß.-]*(?:[ -][\p{L}ß.-]+)*?)\s+(\d+[a-zA-Z]?(?:\s?-\s?\d+[a-zA-Z]?)?)\s*[,|·•–\n-]\s*(?:D-)?(\d{5})\s+([A-ZÄÖÜ][\p{L}ß-]+(?:[ -][A-ZÄÖÜ][\p{L}ß-]+)*)/gu
  )) {
    // "BEISPIEL GmbH - Beispielweg": the street is the part after the last separator, at most
    // three words ("Straße des 17. Juni" stays whole, a company name before it does not)
    const street = (match[1].split(/\s[-–·|•]\s|,\s*/).pop() ?? '')
      .trim()
      .split(/\s+/)
      .slice(-3)
      .join(' ')
    // "Rechnung Nr 12, 50667 Köln" is no street
    if (/^(rechnung|nr|kunden|invoice|seite|datum)/i.test(street)) continue
    addresses.push({
      street,
      streetNumber: match[2].replace(/\s/g, ''),
      zipCode: match[3],
      city: match[4]
    })
  }

  return { ibans, bics, vatIds, taxNumbers, emails, phones, addresses }
}
