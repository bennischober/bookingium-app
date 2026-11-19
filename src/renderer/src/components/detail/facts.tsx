// Facts for a detail page's FactSheet that several pages share
import type { ReactNode } from 'react'
import type { Fact } from './CompactParts'

/** An address as lines for a fact sheet, or null when there is none */
export function addressBlock(
  address:
    | {
        street?: string | null
        streetNumber?: string | null
        addressSuffix?: string | null
        zipCode?: string | null
        city?: string | null
        country?: string | null
      }
    | null
    | undefined
): ReactNode {
  if (!address) return null
  const lines = [
    [address.street, address.streetNumber].filter(Boolean).join(' '),
    address.addressSuffix,
    [address.zipCode, address.city].filter(Boolean).join(' '),
    address.country
  ].filter(Boolean)
  if (lines.length === 0) return null
  return (
    <>
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </>
  )
}

/** The contact rows: e-mail, phones, website */
export function contactFacts(
  contact:
    | {
        email?: string | null
        phone?: string | null
        mobilePhone?: string | null
        homepage?: string | null
      }
    | null
    | undefined
): Fact[] {
  return [
    ['E-Mail', contact?.email],
    ['Telefon', contact?.phone],
    ['Mobil', contact?.mobilePhone],
    ['Website', contact?.homepage]
  ]
}
