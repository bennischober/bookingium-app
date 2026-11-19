import type { ImportPreviewRow } from '../../api/schemas/import.schema'
import {
  cleanText,
  normalizeUrl,
  parseBirthday,
  parseEmails,
  parsePersons,
  type ParsedPerson
} from '../normalize'
import type { PlanContext } from './context'
import { addNotes, fill, type CompanyDraft, type PersonDraft } from './drafts'
import { nameFromEmailWarning, notImported, outletName, personLabel } from './rowHelpers'

// ----------------------------------------
// Person lists
// ----------------------------------------
// One row = one person with contact data and address, optionally a member
// of a company (created if new).

export function buildPersonRows(ctx: PlanContext): ImportPreviewRow[] {
  const previewRows: ImportPreviewRow[] = []

  for (const row of ctx.request.rows) {
    const read = ctx.reader(row)
    if (!read.hasData) continue

    const firstName = cleanText(read.value('firstName'))
    const lastName = cleanText(read.value('lastName'))
    const parsed: ParsedPerson[] =
      firstName || lastName
        ? [
            {
              firstName: firstName || lastName,
              lastName: firstName ? lastName : '',
              role: '',
              notes: ''
            }
          ]
        : parsePersons(read.value('personName'))
    let companyName = cleanText(read.value('companyName'))
    const emailText = read.values('email').join(' ')
    const emails = parseEmails(emailText)
    const warnings: string[] = []

    // Media lists: a bare address is the outlet of its domain
    if (ctx.mediaList && parsed.length === 0 && !companyName && emails.length > 0) {
      companyName = outletName(emails[0], undefined)
      warnings.push(nameFromEmailWarning(companyName))
    }
    const names = { primary: parsed[0] ? personLabel(parsed[0]) : '', company: companyName }

    if (ctx.excluded.has(row.rowNumber)) {
      previewRows.push(notImported(row.rowNumber, 'excluded', names))
      continue
    }
    if (parsed.length === 0 && !companyName) {
      previewRows.push(
        notImported(row.rowNumber, 'skipped', names, ['Kein Name – wird übersprungen'])
      )
      continue
    }

    if (parsed.length > 1) {
      warnings.push(`Mehrere Namen – nur „${personLabel(parsed[0])}“ wird übernommen`)
    }
    const company = companyName ? ctx.companyFor(companyName, row.rowNumber, ctx.companyKind) : null
    if (company && ctx.mediaList) ctx.listGenres(company)
    // A row with a company but no person holds the company's own data
    const person = parsed[0]
      ? ctx.personFor(parsed[0], company?.key ?? `row:${row.rowNumber}`, row.rowNumber, emails)
      : null
    const holder: PersonDraft | CompanyDraft = (person ?? company)!

    const { address, hasStreetAddress } = ctx.addressOf(read)
    if (hasStreetAddress) fill(holder.address, address)

    const notes = read.notes()
    const birthdayText = cleanText(read.value('birthday'))
    if (birthdayText) {
      const birthday = person ? parseBirthday(birthdayText) : ''
      if (person && birthday) fill(person, { birthday })
      else notes.push(`Geburtstag: ${birthdayText}`)
    }

    if (emailText && emails.length === 0) {
      warnings.push(`Keine gültige E-Mail-Adresse: „${cleanText(emailText)}“`)
    }
    ctx.takeEmails(person ? 'person' : 'company', holder, emails)
    fill(holder.contact, {
      phone: cleanText(read.value('phone')),
      mobilePhone: cleanText(read.value('mobile')),
      homepage: normalizeUrl(read.value('homepage'))
    })
    const role = cleanText(read.value('role'))
    if (!person && role) notes.push(`Rolle: ${role}`)
    addNotes(holder, notes)

    if (person && company && !company.members.has(person.key)) {
      company.members.set(person.key, role || parsed[0].role)
    }

    previewRows.push({
      rowNumber: row.rowNumber,
      status: 'record',
      primary: person ? ctx.refOf(person, personLabel(person), row.rowNumber) : null,
      company: company ? ctx.refOf(company, company.name, row.rowNumber) : null,
      persons: [],
      warnings
    })
  }
  return previewRows
}
