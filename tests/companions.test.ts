// #149: a person's, company's, venue's or hotel's address and contact rows go with it.
// The foreign key runs from the owner, so the repositories delete them
// (repositories/companions.ts) once no owner references them any more.
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { container } from 'tsyringe'
import { setupTestDb, getTestDb } from './helpers/setup'
import { PersonService } from '../src/main/services/PersonService'
import { CompanyService } from '../src/main/services/CompanyService'
import { VenueService } from '../src/main/services/VenueService'
import { HotelService } from '../src/main/services/HotelService'

setupTestDb()

const address = (city: string) => ({
  street: 'Musterstraße',
  streetNumber: '1',
  addressSuffix: '',
  zipCode: '12345',
  city,
  state: '',
  country: 'Deutschland',
  countryCode: 'DE'
})

const contact = (email: string, otherEmails: string[] = []) => ({
  email,
  otherEmails,
  phone: '',
  mobilePhone: '',
  homepage: ''
})

const exists = (table: 'address' | 'contact' | 'bank', id: number | null | undefined): boolean =>
  id != null &&
  getTestDb().sqlite.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id) !== undefined

const emailRows = (contactId: number): number =>
  (
    getTestDb()
      .sqlite.prepare('SELECT count(*) AS n FROM contact_email WHERE contact_id = ?')
      .get(contactId) as { n: number }
  ).n

const persons = () => container.resolve(PersonService)

async function createPerson(city: string) {
  const created = await persons().createPerson({
    firstName: 'Erika',
    lastName: 'Musterfrau',
    birthday: null,
    notes: null,
    address: address(city),
    contact: contact('erika@example.test', ['privat@example.test'])
  })
  return (await persons().getPersonById(created.id))!
}

describe('deleting an owner', () => {
  it('deletes a person’s address, contact and further email addresses', async () => {
    const person = await createPerson('Musterstadt')
    const contactId = person.contact!.id
    expect(emailRows(contactId)).toBe(1)

    await persons().deletePerson(person.id)

    expect(exists('address', person.address!.id)).toBe(false)
    expect(exists('contact', contactId)).toBe(false)
    expect(emailRows(contactId)).toBe(0)
  })

  it('deletes a company’s address and contact but keeps its bank', async () => {
    const { sqlite } = getTestDb()
    const bankId = Number(
      sqlite.prepare("INSERT INTO bank (bank_name) VALUES ('Musterbank')").run().lastInsertRowid
    )
    const service = container.resolve(CompanyService)
    const created = await service.createCompany({
      name: 'Muster GmbH',
      notes: '',
      vatId: '',
      taxNumber: '',
      commercialRegisterNo: '',
      registerCourt: '',
      logoPath: '',
      isDefaultForInvoicing: false,
      bankId,
      address: address('Musterstadt'),
      contact: contact('office@example.test')
    })
    const company = (await service.getCompanyById(created.id))!

    await service.deleteCompany(company.id)

    expect(exists('address', company.address!.id)).toBe(false)
    expect(exists('contact', company.contact!.id)).toBe(false)
    expect(exists('bank', bankId)).toBe(true)
  })

  it('deletes a venue’s and a hotel’s address and contact', async () => {
    const venues = container.resolve(VenueService)
    const createdVenue = await venues.createVenue({
      name: 'Musterhalle',
      kind: 'venue',
      genres: '',
      notes: '',
      address: address('Musterstadt'),
      contact: contact('booking@venue.example.test')
    })
    const venue = (await venues.getVenueById(createdVenue.id))!
    await venues.deleteVenue(venue.id)
    expect(exists('address', venue.address!.id)).toBe(false)
    expect(exists('contact', venue.contact!.id)).toBe(false)

    const hotels = container.resolve(HotelService)
    const createdHotel = await hotels.createHotel({
      name: 'Hotel Muster',
      notes: '',
      address: address('Musterstadt'),
      contact: contact('rezeption@hotel.example.test')
    })
    const hotel = (await hotels.getHotelById(createdHotel.id))!
    await hotels.deleteHotel(hotel.id)
    expect(exists('address', hotel.address!.id)).toBe(false)
    expect(exists('contact', hotel.contact!.id)).toBe(false)
  })

  it('keeps an address another owner still uses', async () => {
    const first = await createPerson('Musterstadt')
    const addressId = first.address!.id
    const venues = container.resolve(VenueService)
    const venue = await venues.createVenue({
      name: 'Musterhalle',
      kind: 'venue',
      genres: '',
      notes: '',
      addressId
    })

    await persons().deletePerson(first.id)
    expect(exists('address', addressId)).toBe(true)

    await venues.deleteVenue(venue.id)
    expect(exists('address', addressId)).toBe(false)
  })
})

describe('pointing an owner at other rows', () => {
  it('deletes the rows it used before once nobody uses them', async () => {
    const venues = container.resolve(VenueService)
    const created = await venues.createVenue({
      name: 'Musterhalle',
      kind: 'venue',
      genres: '',
      notes: '',
      address: address('Musterstadt'),
      contact: contact('booking@venue.example.test', ['info@venue.example.test'])
    })
    const venue = (await venues.getVenueById(created.id))!
    const other = await createPerson('Anderstadt')
    const oldContactId = venue.contact!.id

    await venues.updateVenue({
      id: venue.id,
      name: 'Musterhalle',
      kind: 'venue',
      notes: '',
      addressId: other.address!.id,
      contactId: other.contact!.id
    })

    expect(exists('address', venue.address!.id)).toBe(false)
    expect(exists('contact', oldContactId)).toBe(false)
    expect(emailRows(oldContactId)).toBe(0)
    expect((await venues.getVenueById(venue.id))?.address?.id).toBe(other.address!.id)
    // The person still has them
    expect(exists('address', other.address!.id)).toBe(true)
    expect(exists('contact', other.contact!.id)).toBe(true)
  })

  it('keeps the rows when an update leaves them in place', async () => {
    const person = await createPerson('Musterstadt')
    await persons().updatePerson({
      id: person.id,
      firstName: 'Erika',
      lastName: 'Muster',
      birthday: null,
      notes: null,
      address: address('Neustadt'),
      contact: contact('erika@example.test')
    })
    const updated = (await persons().getPersonById(person.id))!
    expect(updated.address?.id).toBe(person.address!.id)
    expect(updated.address?.city).toBe('Neustadt')
    expect(updated.contact?.id).toBe(person.contact!.id)
  })
})
