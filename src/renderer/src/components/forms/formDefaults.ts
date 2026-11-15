import type { AddressDto } from '../../../../main/api/schemas/address.schema'
import type { ContactDto } from '../../../../main/api/schemas/contact.schema'
import { contactHasValues } from './contactEmailFields'

/**
 * #171: the start values of the address and contact parts of a form
 * (`AddressFormFields`, `ContactFormFields`) and the "only send it when something is
 * filled in" rule. Pure, so it is unit-tested.
 */

export type AddressValues = Omit<AddressDto, 'id'>

export function addressDefaults(address?: AddressDto | null): AddressValues {
  return {
    street: address?.street ?? '',
    streetNumber: address?.streetNumber ?? '',
    addressSuffix: address?.addressSuffix ?? '',
    zipCode: address?.zipCode ?? '',
    city: address?.city ?? '',
    state: address?.state ?? '',
    country: address?.country ?? '',
    countryCode: address?.countryCode ?? ''
  }
}

/** Phone, mail and homepage: the contact part without the mail linking (hotels) */
export type BasicContactValues = Pick<ContactDto, 'email' | 'phone' | 'mobilePhone' | 'homepage'>

export function basicContactDefaults(contact?: ContactDto | null): BasicContactValues {
  return {
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    mobilePhone: contact?.mobilePhone ?? '',
    homepage: contact?.homepage ?? ''
  }
}

/** The whole contact part: also the further addresses and "Keine Werbung" */
export type ContactValues = Omit<ContactDto, 'id'>

export function contactDefaults(contact?: ContactDto | null): ContactValues {
  return {
    email: contact?.email ?? '',
    otherEmails: contact?.otherEmails ?? [],
    phone: contact?.phone ?? '',
    mobilePhone: contact?.mobilePhone ?? '',
    homepage: contact?.homepage ?? '',
    noAdvertising: contact?.noAdvertising ?? false
  }
}

/** `{ address }` when any part is filled in, otherwise nothing */
export function optionalAddress(address: AddressValues): { address?: AddressValues } {
  const filled = Object.values(address).some((entry) => entry.trim().length > 0)
  return filled ? { address } : {}
}

/** `{ contact }` when it holds anything worth saving, otherwise nothing */
export function optionalContact<T extends BasicContactValues>(contact: T): { contact?: T } {
  return contactHasValues(contact) ? { contact } : {}
}
