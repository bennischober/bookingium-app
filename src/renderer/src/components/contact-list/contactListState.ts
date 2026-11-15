// #61: the mailing list page's filter rules, out of the page.

import {
  ContactListFilters,
  type SavedContactListDto
} from '../../../../main/api/schemas/contactList.schema'

export const EMPTY_FILTERS: ContactListFilters = ContactListFilters.parse({})

/** Above this, mail providers start to refuse or flag a BCC email */
export const LARGE_LIST = 50

const countryNames = new Intl.DisplayNames(['de'], { type: 'region' })

/** A country code's German name, or the code itself if it has none */
export function countryLabel(code: string): string {
  try {
    return countryNames.of(code) ?? code
  } catch {
    return code
  }
}

export const sameFilters = (a: ContactListFilters, b: ContactListFilters) =>
  JSON.stringify(a) === JSON.stringify(b)

/** A typed capacity, digits only; empty or no digits is no bound */
export function parseCapacity(value: string): number | null {
  const number = Number.parseInt(value.replace(/\D/g, ''), 10)
  return Number.isNaN(number) ? null : number
}

/** How many filters narrow the list (the Filter button's count) */
export function activeFilterCount(filters: ContactListFilters): number {
  return [
    filters.kinds.length > 0,
    filters.recipientTypes.length > 0,
    filters.countryCodes.length > 0,
    filters.states.length > 0,
    filters.zipPrefixes.trim() !== '',
    filters.capacityMin !== null || filters.capacityMax !== null,
    filters.genres.length > 0,
    filters.booked !== 'all'
  ].filter(Boolean).length
}

/**
 * Whether the filters differ from what is stored: from the saved list, or from
 * no filters for a new one. A member list (#154) has no filters to change.
 */
export function filtersChanged(
  saved: Pick<SavedContactListDto, 'kind' | 'filters'> | null,
  filters: ContactListFilters
): boolean {
  if (saved?.kind === 'members') return false
  return !sameFilters(saved?.filters ?? EMPTY_FILTERS, filters)
}

export const addresses = (count: number) => `${count} ${count === 1 ? 'Adresse' : 'Adressen'}`
