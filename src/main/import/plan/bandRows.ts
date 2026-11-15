import type { ImportPreviewRow } from '../../api/schemas/import.schema'
import { cleanText, normalizeKey, parseEmails, parsePersons } from '../normalize'
import type { PlanContext } from './context'
import { addNotes, fill, type BandDraft } from './drafts'
import { notImported, personLabel } from './rowHelpers'

// ----------------------------------------
// Band lists
// ----------------------------------------
// One row = a band (its company must exist) with members and technical lead.
// Rows without a band name add members to the band above.

export function buildBandRows(ctx: PlanContext): ImportPreviewRow[] {
  const previewRows: ImportPreviewRow[] = []
  let previous: BandDraft | null = null
  // The band above is not imported: its follow-up rows neither
  let previousMissing: 'excluded' | 'skipped' | null = null

  for (const row of ctx.request.rows) {
    const read = ctx.reader(row)
    if (!read.hasData) continue

    const bandName = cleanText(read.value('bandName'))
    const companyName = cleanText(read.value('companyName'))
    const members = read.values('members').flatMap((raw) => parsePersons(raw))
    const lead = parsePersons(read.value('responsiblePerson'))[0] ?? null
    const isContinuation = !bandName
    const names = {
      primary: bandName,
      company: companyName,
      persons: [...members, ...(lead ? [lead] : [])].map(personLabel)
    }

    if (ctx.excluded.has(row.rowNumber) || (isContinuation && previousMissing === 'excluded')) {
      previewRows.push(notImported(row.rowNumber, 'excluded', names))
      if (!isContinuation) {
        previous = null
        previousMissing = 'excluded'
      }
      continue
    }
    if (isContinuation && !previous) {
      previewRows.push(
        notImported(row.rowNumber, 'skipped', names, [
          previousMissing === 'skipped'
            ? 'Die Band darüber wird nicht importiert'
            : 'Kein Bandname in dieser oder der Zeile darüber – wird übersprungen'
        ])
      )
      continue
    }

    const warnings: string[] = []
    let band: BandDraft
    if (isContinuation && previous) {
      band = previous
    } else {
      // Business rule: every band belongs to a company that already exists
      const companyId = companyName ? ctx.companiesByName.get(normalizeKey(companyName)) : undefined
      if (companyId === undefined) {
        previewRows.push(
          notImported(row.rowNumber, 'skipped', names, [
            companyName
              ? `Firma „${companyName}“ nicht gefunden – bitte zuerst unter Firmen anlegen`
              : 'Keine Firma angegeben – jede Band gehört zu einer Firma'
          ])
        )
        previous = null
        previousMissing = 'skipped'
        continue
      }
      band = ctx.bandFor(bandName, companyId, row.rowNumber)
      previous = band
      previousMissing = null
      fill(band, {
        genre: cleanText(read.value('genre')),
        founded: cleanText(read.value('founded'))
      })
      const management = cleanText(read.value('managementCompany'))
      if (management) {
        const managementId = ctx.companiesByName.get(normalizeKey(management))
        if (managementId === undefined) {
          warnings.push(`Management „${management}“ nicht gefunden – wird nicht zugeordnet`)
        } else if (band.managementCompanyId === null) {
          band.managementCompanyId = managementId
        }
      }
    }

    // ---- Members and technical lead ----
    const memberDrafts = members.map((parsed) => {
      const person = ctx.personFor(parsed, band.key, row.rowNumber)
      if (!band.members.has(person.key)) band.members.set(person.key, parsed.role)
      return person
    })
    const leadDraft = lead ? ctx.personFor(lead, band.key, row.rowNumber) : null
    if (leadDraft && band.responsiblePersonKey === null) band.responsiblePersonKey = leadDraft.key

    // Contact columns describe the technical lead (else a single member)
    const notes = read.notes()
    const contactPerson = leadDraft ?? (memberDrafts.length === 1 ? memberDrafts[0] : null)
    const emails = parseEmails(read.values('email').join(' '))
    const phone = cleanText(read.value('phone'))
    const mobile = cleanText(read.value('mobile'))
    if (contactPerson) {
      ctx.takeEmails('person', contactPerson, emails)
      fill(contactPerson.contact, { phone, mobilePhone: mobile })
    } else {
      if (emails.length > 0) notes.push(`E-Mail: ${emails.join(', ')}`)
      if (phone) notes.push(`Telefon: ${phone}`)
      if (mobile) notes.push(`Mobil: ${mobile}`)
    }
    const people = [...memberDrafts, ...(leadDraft ? [leadDraft] : [])]
    addNotes(isContinuation && people.length === 1 ? people[0] : band, notes)

    const at = isContinuation ? Infinity : row.rowNumber
    previewRows.push({
      rowNumber: row.rowNumber,
      status: isContinuation ? 'continuation' : 'record',
      primary: ctx.refOf(band, band.name, at),
      company: isContinuation ? null : { label: companyName, action: 'existing' },
      persons: [
        ...memberDrafts.map((person) => ctx.refOf(person, personLabel(person), row.rowNumber)),
        ...(leadDraft
          ? [
              {
                ...ctx.refOf(leadDraft, personLabel(leadDraft), row.rowNumber),
                label: `${personLabel(leadDraft)} (Technischer Leiter)`
              }
            ]
          : [])
      ],
      warnings
    })
  }
  return previewRows
}
