import type { ImportPreviewRow } from '../../api/schemas/import.schema'
import {
  cleanText,
  emailDomain,
  isFreemailDomain,
  looksLikeDomain,
  normalizeKey,
  normalizeUrl,
  parseCapacity,
  parseEmails,
  parsePersons,
  parseTaxId,
  type ParsedPerson
} from '../normalize'
import { parseCapacityRange } from '../../api/schemas/capacity'
import type { PlanContext } from './context'
import { addGenres, addNotes, fill, type CompanyDraft, type VenueDraft } from './drafts'
import { nameFromEmailWarning, notImported, outletName, personLabel } from './rowHelpers'

const DEFAULT_ROLE = 'Ansprechpartner'

/** Whether an email's local part mentions the person ("carlos@…", "j.smith@…") */
function emailMatchesPerson(email: string, person: ParsedPerson): boolean {
  const local = normalizeKey(email.split('@')[0])
  return [person.firstName, person.lastName]
    .map((name) => normalizeKey(name))
    .some((name) => name.length >= 3 && name.split(' ').some((part) => local.includes(part)))
}

// ----------------------------------------
// Venue and company lists
// ----------------------------------------
// One row = a venue/festival and/or a company (promoter) with contacts.
// Rows without either add contacts to the row above.

export function buildOrganisationRows(ctx: PlanContext): ImportPreviewRow[] {
  const previewRows: ImportPreviewRow[] = []
  let previous: { venue: VenueDraft | null; company: CompanyDraft | null } | null = null
  let previousExcluded = false
  // Email domains (not freemail) seen per company key, for media lists
  const domains = new Map<string, Set<string>>()
  let month = ''

  for (const row of ctx.request.rows) {
    const read = ctx.reader(row)
    const monthValue = cleanText(read.value('month'))
    if (monthValue) month = monthValue
    // Rows with nothing but a month are section headings ("FEBRUAR")
    if (!read.hasData) continue

    const venueName = cleanText(read.value('venueName'))
    let companyName = cleanText(read.value('companyName'))
    const parsedPersons = read.values('contactPerson').flatMap((raw) => parsePersons(raw))
    const emailText = read.values('email').join(' ')
    const emails = parseEmails(emailText)
    const phone = cleanText(read.value('phone'))
    const mobile = cleanText(read.value('mobile'))
    const warnings: string[] = []

    // Media lists: a row without an outlet is the outlet of its address,
    // unless the address is at the domain of the outlet above
    if (
      ctx.mediaList &&
      !venueName &&
      !companyName &&
      emails.length > 0 &&
      !(previous?.company && domains.get(previous.company.key)?.has(emailDomain(emails[0])))
    ) {
      companyName = outletName(emails[0], parsedPersons[0])
      warnings.push(nameFromEmailWarning(companyName))
    }

    const isContinuation = !venueName && !companyName
    const names = {
      primary: venueName,
      company: companyName,
      persons: parsedPersons.map(personLabel)
    }

    if (ctx.excluded.has(row.rowNumber) || (isContinuation && previousExcluded)) {
      previewRows.push(notImported(row.rowNumber, 'excluded', names))
      if (!isContinuation) {
        previous = null
        previousExcluded = true
      }
      continue
    }
    if (isContinuation && !previous) {
      previewRows.push(
        notImported(row.rowNumber, 'skipped', names, [
          'Kein Name in dieser oder der Zeile darüber – wird übersprungen'
        ])
      )
      continue
    }

    const { address, hasStreetAddress } = ctx.addressOf(read)

    // ---- Venue and company of this row ----
    let venue: VenueDraft | null
    let company: CompanyDraft | null
    if (isContinuation && previous) {
      venue = previous.venue
      company = previous.company
    } else {
      const venueCity = cleanText(read.value('venueCity')) || (companyName ? '' : address.city)
      company = companyName ? ctx.companyFor(companyName, row.rowNumber, ctx.companyKind) : null
      venue = venueName ? ctx.venueFor(venueName, venueCity, row.rowNumber) : null
      if (venue) {
        fill(venue.address, {
          city: venueCity,
          state: address.state,
          country: address.country,
          countryCode: address.countryCode
        })
        if (company && !venue.companyKey) venue.companyKey = company.key
      }
      previous = { venue, company }
      previousExcluded = false
    }
    // Contact data belongs to the promoter; without one, to the venue
    const organisation: CompanyDraft | VenueDraft = (company ?? venue)!

    // Postal address: the company's; without a company, the venue's. The
    // Land column describes the venue when there is one.
    const postal = venue ? { ...address, state: '' } : address
    if (hasStreetAddress) fill(organisation.address, postal)
    else if (company) {
      fill(company.address, {
        state: postal.state,
        country: postal.country,
        countryCode: postal.countryCode
      })
    }

    // ---- Notes ----
    const notes: string[] = []
    if (month && !isContinuation && ctx.columnOf('month') >= 0) notes.push(`Monat: ${month}`)
    notes.push(...read.notes())

    const capacityText = cleanText(read.value('capacity'))
    if (capacityText) {
      // #245: "500-1000" is a range, not 500 with a note
      const range = parseCapacityRange(capacityText)
      const capacity = range.max ?? parseCapacity(capacityText)
      if (venue && capacity !== null && venue.capacity === null) {
        venue.capacity = capacity
        venue.capacityMin = range.min
      }
      if (capacity === null || !/^[\d.\s]+(?:(?:[-–]|bis)[\d.\s]+)?$/i.test(capacityText)) {
        notes.push(`Kapazität: ${capacityText}`)
      }
    }

    const taxText = cleanText(read.value('taxId'))
    if (taxText) {
      if (company) fill(company, parseTaxId(taxText))
      else notes.push(`USt-IdNr./Steuernummer: ${taxText}`)
    }

    // Genre tags: the club/festival's; in company lists the company's
    const genreText = cleanText(read.value('genre'))
    const tagged: VenueDraft | CompanyDraft | null =
      venue ?? (ctx.request.target === 'companies' ? company : null)
    if (tagged && !isContinuation) {
      if (genreText) addGenres(tagged, genreText)
      if (venue || ctx.mediaList) ctx.listGenres(tagged)
    } else if (genreText) {
      notes.push(`Genre: ${genreText}`)
    }

    // ---- Contact data ----
    const homepage =
      normalizeUrl(read.value('homepage')) ||
      (emails.length === 0 && looksLikeDomain(emailText) ? normalizeUrl(emailText) : '')
    if (homepage) {
      fill(organisation.contact, { homepage })
      if (venue && venue !== organisation) fill(venue.contact, { homepage })
    }
    if (emailText && emails.length === 0 && !homepage) {
      warnings.push(`Keine gültige E-Mail-Adresse: „${cleanText(emailText)}“`)
    }

    // Personal addresses go to the persons, the rest to the company/venue
    const personEmails = parsedPersons.map((person, index): string => {
      const named = emails.find((email) => emailMatchesPerson(email, person))
      if (named) return named
      if (emails.length === parsedPersons.length) return emails[index]
      return parsedPersons.length === 1 && emails.length === 1 ? emails[0] : ''
    })
    const generalEmail = emails.find((email) => !personEmails.includes(email)) ?? emails[0] ?? ''
    fill(organisation.contact, { email: generalEmail, phone })
    if (parsedPersons.length !== 1) fill(organisation.contact, { mobilePhone: mobile })
    // Addresses no one else takes are the organisation's further ones
    ctx.takeEmails(
      organisation === company ? 'company' : 'venue',
      organisation,
      emails.filter((email) => !personEmails.includes(email))
    )
    if (company) {
      const seen = domains.get(company.key) ?? new Set<string>()
      for (const email of emails) {
        const domain = emailDomain(email)
        if (!isFreemailDomain(domain)) seen.add(domain)
      }
      domains.set(company.key, seen)
    }

    // ---- Persons ----
    const scopeKey = company?.key ?? venue?.key ?? ''
    const personDrafts = parsedPersons.map((parsed) =>
      ctx.personFor(parsed, scopeKey, row.rowNumber)
    )
    const personRefs = parsedPersons.map((parsed, index) => {
      const person = personDrafts[index]
      if (personEmails[index]) ctx.takeEmails('person', person, [personEmails[index]])
      if (parsedPersons.length === 1) fill(person.contact, { phone, mobilePhone: mobile })
      const role = parsed.role || DEFAULT_ROLE
      if (company && !company.members.has(person.key)) company.members.set(person.key, role)
      if (venue && !venue.members.has(person.key)) venue.members.set(person.key, role)
      return ctx.refOf(person, personLabel(person), row.rowNumber)
    })

    // A follow-up row's comment is about its one contact ("zuständig für …")
    addNotes(
      isContinuation && personDrafts.length === 1 ? personDrafts[0] : (venue ?? organisation),
      notes
    )

    const at = isContinuation ? Infinity : row.rowNumber
    previewRows.push({
      rowNumber: row.rowNumber,
      status: isContinuation ? 'continuation' : 'record',
      primary: venue
        ? ctx.refOf(
            venue,
            venue.address.city ? `${venue.name} (${venue.address.city})` : venue.name,
            at
          )
        : null,
      company: company ? ctx.refOf(company, company.name, at) : null,
      persons: personRefs,
      warnings
    })
  }
  return previewRows
}
