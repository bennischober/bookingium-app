import { useMemo } from 'react'
import { trpcReact } from '@/lib/trpc'
import {
  DOCUMENT_OWNER_TYPES,
  type DocumentOwnerType
} from '../../../../main/api/schemas/document.schema'

/**
 * The records a mail's attachment can be saved to (F9) and a mail can be linked to by
 * hand ("Zuordnen…"): the same five types, picked by name.
 */
export type RecordType = DocumentOwnerType
export const RECORD_TYPES = DOCUMENT_OWNER_TYPES

export const RECORD_LABELS: Record<RecordType, string> = {
  event: 'Event',
  band: 'Band',
  company: 'Firma',
  venue: 'Spielstätte',
  person: 'Person'
}

/** One record the picker can offer */
export type RecordChoice = { id: number; label: string }

export const isRecordType = (type: string): type is RecordType =>
  (RECORD_TYPES as readonly string[]).includes(type)

/**
 * F9: the records of one type, searched by name through that type's own list
 * procedure - the same one its page uses, so the results match what the user knows.
 */
export function useRecordChoices(type: RecordType, search: string, enabled = true): RecordChoice[] {
  const input = { page: 1, pageSize: 20, search: search.trim() || undefined }
  // One query per type: the hooks cannot be called conditionally
  const bands = trpcReact.band.getAllPaginated.useQuery(input, {
    enabled: enabled && type === 'band'
  })
  const persons = trpcReact.person.getAllPaginated.useQuery(input, {
    enabled: enabled && type === 'person'
  })
  const companies = trpcReact.company.getAllPaginated.useQuery(input, {
    enabled: enabled && type === 'company'
  })
  const venues = trpcReact.venue.getAllPaginated.useQuery(input, {
    enabled: enabled && type === 'venue'
  })
  const events = trpcReact.dealMemo.getAllPaginated.useQuery(input, {
    enabled: enabled && type === 'event'
  })

  return useMemo(() => {
    switch (type) {
      case 'band':
        return (bands.data?.items ?? []).map((r) => ({ id: r.id, label: r.name }))
      case 'person':
        return (persons.data?.items ?? []).map((r) => ({
          id: r.id,
          label: [r.firstName, r.lastName].filter(Boolean).join(' ') || `Person ${r.id}`
        }))
      case 'company':
        return (companies.data?.items ?? []).map((r) => ({ id: r.id, label: r.name }))
      case 'venue':
        return (venues.data?.items ?? []).map((r) => ({ id: r.id, label: r.name }))
      case 'event':
        return (events.data?.items ?? []).map((r) => ({
          id: r.id,
          label: [r.name, r.deal].filter(Boolean).join(' · ')
        }))
    }
  }, [type, bands.data, persons.data, companies.data, venues.data, events.data])
}
