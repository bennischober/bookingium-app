// #122: what "Event anlegen" from a mail prefills - the name from the subject, the first
// date from today on, and the sender's person, company or venue when there is one each.
import { describe, expect, it } from 'vitest'
import {
  eventNameFromSubject,
  eventPrefillFromMail,
  findEventDate
} from '../src/renderer/src/components/mail/eventPrefill'

const TODAY = '2026-11-06'

describe('eventNameFromSubject', () => {
  it('drops reply and forward prefixes, however many and however written', () => {
    expect(eventNameFromSubject('AW: WG: Re[2]: Anfrage Konzert')).toBe('Anfrage Konzert')
    expect(eventNameFromSubject('Fwd: RE(3): Booking request')).toBe('Booking request')
    expect(eventNameFromSubject('antw:  SV: VS: Anfrage')).toBe('Anfrage')
  })

  it('collapses whitespace and keeps a subject without prefix as it is', () => {
    expect(eventNameFromSubject('  Anfrage \t Sommerfest  ')).toBe('Anfrage Sommerfest')
    expect(eventNameFromSubject('Rechnung 12')).toBe('Rechnung 12')
  })

  it('does not take a word that only begins like a prefix', () => {
    expect(eventNameFromSubject('Review: Abend')).toBe('Review: Abend')
    expect(eventNameFromSubject('Awards: Gala')).toBe('Awards: Gala')
  })

  it('leaves an empty subject empty', () => {
    expect(eventNameFromSubject('')).toBe('')
    expect(eventNameFromSubject('AW:')).toBe('')
  })
})

describe('findEventDate', () => {
  const find = (text: string): string => findEventDate([text], TODAY)

  it('reads German numeric dates with four- and two-digit years', () => {
    expect(find('Wir dachten an den 14.03.2027.')).toBe('2027-03-14')
    expect(find('am 4.3.27 bei uns')).toBe('2027-03-04')
    expect(find('am 14. 03. 2027')).toBe('2027-03-14')
  })

  it('reads ISO dates', () => {
    expect(find('Datum: 2027-05-01')).toBe('2027-05-01')
  })

  it('reads German and English month names, full and abbreviated', () => {
    expect(find('am 14. März 2027')).toBe('2027-03-14')
    expect(find('am 2. Maerz 2027')).toBe('2027-03-02')
    expect(find('on 14 March 2027')).toBe('2027-03-14')
    expect(find('on March 14th, 2027')).toBe('2027-03-14')
    expect(find('am 3. Dez. 2026')).toBe('2026-12-03')
    expect(find('Freitag, 5. Feb 2027')).toBe('2027-02-05')
  })

  it('takes the first day of a range', () => {
    expect(find('Festival 14.-15.03.2027')).toBe('2027-03-14')
    expect(find('Festival 14. – 16. Mai 2027')).toBe('2027-05-14')
  })

  it('reads a date without a year as the next such day', () => {
    // Still to come this year
    expect(find('am 20.12.')).toBe('2026-12-20')
    expect(find('am 20. Dezember')).toBe('2026-12-20')
    // Past this year, so next year's
    expect(find('am 14.03.')).toBe('2027-03-14')
    expect(find('on March 14')).toBe('2027-03-14')
    // Today counts
    expect(find('heute, 6.11.')).toBe('2026-11-06')
  })

  it('skips dates already past, such as a quoted reply header', () => {
    expect(find('Am 03.11.2026 schrieb jemand: wie wäre der 12.06.2027?')).toBe('2027-06-12')
    expect(find('Die Tour 2019-05-01 war schön.')).toBe('')
  })

  it('skips dates that do not exist', () => {
    expect(find('am 31.02.2027')).toBe('')
    expect(find('am 2027-13-01')).toBe('')
    expect(find('am 29.02.2028')).toBe('2028-02-29')
  })

  it('does not read times, prices or version numbers as dates', () => {
    expect(find('Einlass 19.30 Uhr')).toBe('')
    expect(find('Gage 1.500,00 EUR')).toBe('')
    expect(find('Version 1.2.3')).toBe('')
    expect(find('Telefon 0221 123456')).toBe('')
  })

  it('looks in the subject before the body', () => {
    expect(findEventDate(['Anfrage 20.12.2026', 'oder der 10.12.2026?'], TODAY)).toBe('2026-12-20')
    expect(findEventDate(['Anfrage', 'am 10.12.2026'], TODAY)).toBe('2026-12-10')
    expect(findEventDate(['Anfrage', null], TODAY)).toBe('')
  })

  it('takes the first date in the text, whatever form each is in', () => {
    expect(find('am 1. Mai 2027 oder am 2027-04-01')).toBe('2027-05-01')
  })
})

describe('eventPrefillFromMail', () => {
  it('takes the name, the date and the one person, company and venue of the sender', () => {
    expect(
      eventPrefillFromMail({
        subject: 'AW: Anfrage 14.03.2027',
        text: 'Hallo',
        senderOwners: [
          { entityType: 'person', entityId: 3 },
          { entityType: 'company', entityId: 8 },
          { entityType: 'venue', entityId: 5 }
        ],
        today: TODAY
      })
    ).toEqual({
      name: 'Anfrage 14.03.2027',
      date: '2027-03-14',
      venueId: 5,
      loProPersonId: 3,
      loProCompanyId: 8
    })
  })

  it('leaves a type out when the address belongs to several records of it', () => {
    const prefill = eventPrefillFromMail({
      subject: 'Anfrage',
      text: null,
      senderOwners: [
        { entityType: 'person', entityId: 3 },
        { entityType: 'person', entityId: 4 },
        { entityType: 'company', entityId: 8 }
      ],
      today: TODAY
    })
    expect(prefill.loProPersonId).toBeNull()
    expect(prefill.loProCompanyId).toBe(8)
    expect(prefill.venueId).toBeNull()
    expect(prefill.date).toBe('')
  })

  it('prefills no record for an unknown sender', () => {
    const prefill = eventPrefillFromMail({
      subject: 'Anfrage',
      text: 'am 20.12.',
      senderOwners: [],
      today: TODAY
    })
    expect(prefill).toEqual({
      name: 'Anfrage',
      date: '2026-12-20',
      venueId: null,
      loProPersonId: null,
      loProCompanyId: null
    })
  })
})
