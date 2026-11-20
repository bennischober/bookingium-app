// Show-Ordner: where files are filed, and that a stored value is never replaced unasked
import { describe, expect, it } from 'vitest'
import { emptyFacts } from '../src/main/showfolder/extract'
import { planFiles, planSuggestions, type ShowFolderCurrent } from '../src/main/showfolder/plan'

const current = (patch: Partial<ShowFolderCurrent> = {}): ShowFolderCurrent => ({
  itinerary: {},
  presaleCents: null,
  guaranteeCents: null,
  deal: '',
  venue: {
    name: 'Halle Nord',
    capacity: null,
    street: '',
    streetNumber: '',
    zipCode: '',
    city: '',
    notes: ''
  },
  hotel: null,
  hotelByName: null,
  loproPersonId: null,
  localContactId: null,
  personsByEmail: new Map(),
  venueMemberIds: new Set(),
  eventDocuments: new Set(),
  venueDocuments: new Set(),
  hasSettlement: false,
  ...patch
})

const sources = {
  sheet: 'Day.pdf',
  venue: 'Spec.pdf',
  mail: 'AW.eml',
  contract: '',
  settlement: ''
}

describe('show folder plan', () => {
  it('files plans at the club, leaves doubles and known files unticked', () => {
    const files = planFiles(
      [
        { path: '/a/Plot.pdf', name: 'Plot.pdf', kind: 'stage_plot', readable: true },
        { path: '/a/Day.pages', name: 'Day.pages', kind: 'duplicate', readable: false },
        { path: '/a/Day.pdf', name: 'Day.pdf', kind: 'daysheet', readable: true }
      ],
      current({ eventDocuments: new Set(['Day.pdf']) })
    )
    expect(files.map((f) => [f.name, f.owner, f.documentType, f.include])).toEqual([
      ['Plot.pdf', 'venue', 'stage_plot', true],
      ['Day.pages', 'event', 'other', false],
      ['Day.pdf', 'event', 'other', false]
    ])
  })

  it('files club papers at the event when it has no club', () => {
    const [file] = planFiles(
      [{ path: '/a/Spec.pdf', name: 'Spec.pdf', kind: 'venue_spec', readable: true }],
      current({ venue: null })
    )
    expect(file).toMatchObject({ owner: 'event', include: true })
    expect(file.note).toMatch(/keinen Club/)
  })

  it('fills empty values ticked, offers changes unticked, skips equal ones', () => {
    const facts = emptyFacts()
    facts.itinerary = { getIn: '13:00', doors: '19:00', dinner: '18:00' }
    const suggestions = planSuggestions(
      facts,
      current({ itinerary: { getIn: '13:00', doors: '18:30' } }),
      sources
    )
    expect(suggestions.map((s) => [s.id, s.current, s.include])).toEqual([
      ['itinerary.dinner', '', true],
      ['itinerary.doors', '18:30', false]
    ])
  })

  it('links a known person instead of creating one, and nothing once linked', () => {
    const facts = emptyFacts()
    facts.contacts = [
      {
        role: 'Venue',
        name: 'Erika Muster',
        email: 'erika@halle.example.test',
        phone: '',
        side: 'venue',
        onSite: true
      }
    ]
    const known = new Map([['erika@halle.example.test', { id: 7, name: 'Erika Muster' }]])
    const [first] = planSuggestions(facts, current({ personsByEmail: known }), sources)
    expect(first.action).toMatchObject({
      type: 'person',
      personId: 7,
      venueMember: true,
      localContact: true
    })
    expect(
      planSuggestions(
        facts,
        current({ personsByEmail: known, venueMemberIds: new Set([7]), localContactId: 7 }),
        sources
      )
    ).toEqual([])
  })
})
