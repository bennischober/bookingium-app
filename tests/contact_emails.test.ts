// Several email addresses per contact: `contact.email` stays the primary one, the
// others live in `contact_email`. The person, company, venue and hotel repositories
// all write them through the same helpers, so each gets a round trip here.
import 'reflect-metadata'
import fs from 'fs'
import path from 'path'
import { describe, expect, it, vi } from 'vitest'
import { container } from 'tsyringe'
import { setupTestDb, getTestDb } from './helpers/setup'
import { contactAddressEvents, normalizeOtherEmails } from '../src/main/repositories/contactEmails'
import { PersonService } from '../src/main/services/PersonService'
import { CompanyService } from '../src/main/services/CompanyService'
import { VenueService } from '../src/main/services/VenueService'
import { HotelService } from '../src/main/services/HotelService'
import { ContactInput } from '../src/main/api/schemas/contact.schema'
import { ContactMapper } from '../src/main/api/mappers/contact.mapper'
import {
  contactHasValues,
  otherEmailProblem,
  promoteOtherEmail
} from '../src/renderer/src/components/forms/contactEmailFields'

setupTestDb()

const contact = (email: string, otherEmails?: string[]) => ({
  email,
  ...(otherEmails === undefined ? {} : { otherEmails }),
  phone: '',
  mobilePhone: '',
  homepage: ''
})

const storedEmails = (contactId: number): string[] =>
  (
    getTestDb()
      .sqlite.prepare('SELECT email FROM contact_email WHERE contact_id = ? ORDER BY position')
      .all(contactId) as { email: string }[]
  ).map((row) => row.email)

describe('normalizeOtherEmails', () => {
  it('trims, lower-cases, drops empties, duplicates and the primary, keeping the order', () => {
    expect(
      normalizeOtherEmails(' Erika@Example.test', [
        'zweit@example.test',
        '',
        '  ',
        'ERIKA@example.test',
        ' Zweit@Example.TEST ',
        'dritt@example.test'
      ])
    ).toEqual(['zweit@example.test', 'dritt@example.test'])
  })
})

describe('ContactInput.otherEmails', () => {
  it('normalizes the addresses and allows empty rows', () => {
    const parsed = ContactInput.parse({ email: '', otherEmails: [' Zweit@Example.TEST', ''] })
    expect(parsed.otherEmails).toEqual(['zweit@example.test', ''])
  })

  it('rejects an address that is not one', () => {
    expect(ContactInput.safeParse({ otherEmails: ['kein-at'] }).success).toBe(false)
  })

  it('leaves the stored addresses alone when the field is missing', () => {
    expect(ContactInput.parse({}).otherEmails).toBeUndefined()
  })
})

describe('person addresses', () => {
  const service = () => container.resolve(PersonService)

  it('saves the further addresses and reads them back in order', async () => {
    const created = await service().createPerson({
      firstName: 'Erika',
      lastName: 'Musterfrau',
      birthday: null,
      notes: null,
      contact: contact('erika@example.test', ['privat@example.test', 'buero@example.test'])
    })
    const back = await service().getPersonById(created.id)
    expect(back?.contact?.other_emails).toEqual(['privat@example.test', 'buero@example.test'])
    // The DTO carries them as otherEmails
    expect(ContactMapper.toDto(back!.contact!).otherEmails).toEqual([
      'privat@example.test',
      'buero@example.test'
    ])
  })

  it('keeps them when an update does not send the field, replaces them when it does', async () => {
    const created = await service().createPerson({
      firstName: 'Erika',
      lastName: 'Musterfrau',
      birthday: null,
      notes: null,
      contact: contact('erika@example.test', ['privat@example.test'])
    })
    const contactId = (await service().getPersonById(created.id))!.contact!.id
    await service().updatePerson({
      id: created.id,
      firstName: 'Erika',
      lastName: 'Musterfrau',
      birthday: null,
      notes: null,
      contact: contact('erika@example.test')
    })
    expect(storedEmails(contactId)).toEqual(['privat@example.test'])

    await service().updatePerson({
      id: created.id,
      firstName: 'Erika',
      lastName: 'Musterfrau',
      birthday: null,
      notes: null,
      contact: contact('erika@example.test', ['neu@example.test'])
    })
    expect(storedEmails(contactId)).toEqual(['neu@example.test'])
  })

  it('never keeps the primary address twice, also when an import makes it the primary', async () => {
    const created = await service().createPerson({
      firstName: 'Erika',
      lastName: 'Musterfrau',
      birthday: null,
      notes: null,
      contact: contact('erika@example.test', ['ERIKA@example.test', 'privat@example.test'])
    })
    const contactId = (await service().getPersonById(created.id))!.contact!.id
    expect(storedEmails(contactId)).toEqual(['privat@example.test'])
    // An update without the field (an import) makes a further address the primary one
    await service().updatePerson({
      id: created.id,
      firstName: 'Erika',
      lastName: 'Musterfrau',
      birthday: null,
      notes: null,
      contact: contact('Privat@example.test')
    })
    expect(storedEmails(contactId)).toEqual([])
  })

  it('removes the further addresses with the contact', async () => {
    const created = await service().createPerson({
      firstName: 'Erika',
      lastName: 'Musterfrau',
      birthday: null,
      notes: null,
      contact: contact('erika@example.test', ['privat@example.test'])
    })
    const contactId = (await service().getPersonById(created.id))!.contact!.id
    getTestDb().sqlite.prepare('DELETE FROM person WHERE id = ?').run(created.id)
    getTestDb().sqlite.prepare('DELETE FROM contact WHERE id = ?').run(contactId)
    expect(storedEmails(contactId)).toEqual([])
  })

  it('tells the mail linker that addresses were saved', async () => {
    const saved = vi.fn()
    contactAddressEvents.on('saved', saved)
    try {
      await service().createPerson({
        firstName: 'Erika',
        lastName: 'Musterfrau',
        birthday: null,
        notes: null,
        contact: contact('erika@example.test', ['privat@example.test'])
      })
      expect(saved).toHaveBeenCalled()
    } finally {
      contactAddressEvents.off('saved', saved)
    }
  })
})

describe('company, venue and hotel addresses', () => {
  it('saves and lists a company’s further addresses', async () => {
    const service = container.resolve(CompanyService)
    const created = await service.createCompany({
      name: 'Muster GmbH',
      notes: '',
      vatNumber: '',
      ustNumber: '',
      taxNumber: '',
      commercialRegisterNo: '',
      registerCourt: '',
      logoPath: '',
      isDefaultForInvoicing: false,
      bankId: null,
      contact: contact('office@example.test', ['billing@example.test'])
    })
    expect((await service.getCompanyById(created.id))?.contact?.other_emails).toEqual([
      'billing@example.test'
    ])
    const page = await service.getAllCompaniesPaginated({ page: 1, pageSize: 100 })
    const row = page.items.find((item) => item.id === created.id)
    expect(row?.contact?.other_emails).toEqual(['billing@example.test'])
  })

  it('saves a venue’s and a hotel’s further addresses', async () => {
    const venues = container.resolve(VenueService)
    const venue = await venues.createVenue({
      name: 'Musterhalle',
      kind: 'venue',
      genres: '',
      notes: '',
      contact: contact('', ['booking@venue.example.test'])
    })
    expect((await venues.getVenueById(venue.id))?.contact?.other_emails).toEqual([
      'booking@venue.example.test'
    ])

    const hotels = container.resolve(HotelService)
    const hotel = await hotels.createHotel({
      name: 'Hotel Muster',
      notes: '',
      contact: contact('rezeption@hotel.example.test', ['gruppen@hotel.example.test'])
    })
    expect((await hotels.getHotelById(hotel.id))?.contact?.other_emails).toEqual([
      'gruppen@hotel.example.test'
    ])
  })
})

describe('contact form helpers', () => {
  it('flags a broken address, the primary again and a duplicate further down', () => {
    expect(otherEmailProblem('', 0, 'a@example.test', [''])).toBeUndefined()
    expect(otherEmailProblem('kein-at', 0, '', ['kein-at'])).toBe('Ungültige E-Mail-Adresse')
    expect(otherEmailProblem(' A@Example.test', 0, 'a@example.test', ['A@Example.test'])).toBe(
      'Das ist schon die Haupt-Adresse'
    )
    const others = ['b@example.test', 'B@example.test']
    // Only the second of two equal rows is the duplicate
    expect(otherEmailProblem(others[0], 0, 'a@example.test', others)).toBeUndefined()
    expect(otherEmailProblem(others[1], 1, 'a@example.test', others)).toBe(
      'Diese Adresse steht schon in der Liste'
    )
  })

  it('swaps a further address with the primary one', () => {
    expect(promoteOtherEmail('a@example.test', ['b@example.test', 'c@example.test'], 1)).toEqual({
      email: 'c@example.test',
      otherEmails: ['b@example.test', 'a@example.test']
    })
    // Without a primary the row just moves up
    expect(promoteOtherEmail('', ['b@example.test', 'c@example.test'], 0)).toEqual({
      email: 'b@example.test',
      otherEmails: ['c@example.test']
    })
  })

  it('leaves the further addresses off the hotel form', () => {
    // Hotels only fill the itinerary and get no mail; the further addresses are only for
    // mail linking. Without the field in the payload, the stored ones stay as they are.
    // No component test tooling, so the form's source is checked.
    const source = fs.readFileSync(
      path.join(__dirname, '../src/renderer/src/components/forms/HotelForm.tsx'),
      'utf-8'
    )
    expect(source).toContain('<ContactFormFields form={form} showOtherEmails={false} />')
    expect(source).not.toContain('otherEmails:')
  })

  it('counts a contact with only further addresses as filled in', () => {
    expect(contactHasValues({ email: '', otherEmails: ['', ' '], noAdvertising: false })).toBe(
      false
    )
    expect(contactHasValues({ email: '', otherEmails: ['b@example.test'] })).toBe(true)
  })
})
