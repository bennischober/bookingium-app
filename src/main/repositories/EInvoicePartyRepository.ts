import { and, eq, sql } from 'drizzle-orm'
import { injectable } from 'tsyringe'
import { db } from '../db'
import { schema } from '../db/schema'
import type { Reader, Tx } from './tx'
import { contactAddressEvents, normalizeEmail } from './contactEmails'
import { normalizeKey } from '../import/normalize'
import type {
  EInvoicePartyInput,
  EInvoicePartyMatch,
  EInvoicePartyPersonInput,
  EInvoicePartyPreview,
  EInvoicePartyResult
} from '../api/schemas/einvoice_party.schema'

// #222: writes a company and its people read from a received e-invoice. Like the list
// import, a record already in the app only gets its empty fields filled; nothing the user
// entered is overwritten.

type Values = Record<string, string | number | null | undefined>

const isEmpty = (value: unknown): boolean => value === null || value === undefined || value === ''

const hasValues = (values: Values): boolean =>
  Object.values(values).some((value) => !isEmpty(value))

/** The values for the columns that are still empty in `row` */
function emptyOnly(row: Record<string, unknown>, values: Values): Values {
  const changes: Values = {}
  for (const [column, value] of Object.entries(values)) {
    if (isEmpty(row[column]) && !isEmpty(value)) changes[column] = value
  }
  return changes
}

/** "DE 123 456 789" and "de123456789" are the same VAT id */
export const vatIdKey = (value: string): string => value.replace(/[^0-9A-Za-z]/g, '').toUpperCase()

/** Tax numbers are compared by their digits ("12/345/67890" = "1234567890") */
export const taxNumberKey = (value: string): string => value.replace(/\D/g, '')

const fullName = (first: string, last: string): string => `${first} ${last}`.trim()

function addressValues(address: EInvoicePartyInput['address']): Values {
  return {
    street: address.street,
    street_number: address.streetNumber,
    address_suffix: address.addressSuffix,
    zip_code: address.zipCode,
    city: address.city,
    state: address.state,
    country: address.country,
    country_code: address.countryCode
  }
}

@injectable()
export class EInvoicePartyRepository {
  /** The company the e-invoice names: by VAT id, else tax number, else name */
  findCompany(
    party: Pick<EInvoicePartyInput, 'name' | 'vatId' | 'taxNumber'>,
    reader: Reader = db as unknown as Reader
  ): EInvoicePartyMatch {
    const companies = reader
      .select({
        id: schema.company.id,
        name: schema.company.name,
        vatId: schema.company.vat_id,
        taxNumber: schema.company.tax_number
      })
      .from(schema.company)
      .all()
    const vatId = vatIdKey(party.vatId)
    if (vatId) {
      const found = companies.find((company) => vatIdKey(company.vatId) === vatId)
      if (found) return { id: found.id, name: found.name, by: 'vatId' }
    }
    const taxNumber = taxNumberKey(party.taxNumber)
    if (taxNumber.length >= 8) {
      const found = companies.find((company) => taxNumberKey(company.taxNumber) === taxNumber)
      if (found) return { id: found.id, name: found.name, by: 'taxNumber' }
    }
    const name = normalizeKey(party.name)
    const found = name
      ? companies.find((company) => normalizeKey(company.name) === name)
      : undefined
    return found ? { id: found.id, name: found.name, by: 'name' } : null
  }

  /** A person by e-mail address (primary or further one), else by full name */
  findPerson(
    person: Pick<EInvoicePartyPersonInput, 'firstName' | 'lastName' | 'email'>,
    reader: Reader = db as unknown as Reader
  ): EInvoicePartyMatch {
    const email = normalizeEmail(person.email)
    if (email) {
      const byPrimary = reader
        .select({
          id: schema.person.id,
          first: schema.person.first_name,
          last: schema.person.last_name
        })
        .from(schema.person)
        .innerJoin(schema.contact, eq(schema.person.contact_id, schema.contact.id))
        .where(sql`lower(trim(${schema.contact.email})) = ${email}`)
        .get()
      const found =
        byPrimary ??
        reader
          .select({
            id: schema.person.id,
            first: schema.person.first_name,
            last: schema.person.last_name
          })
          .from(schema.person)
          .innerJoin(
            schema.contact_email,
            eq(schema.person.contact_id, schema.contact_email.contact_id)
          )
          .where(eq(schema.contact_email.email, email))
          .get()
      if (found) return { id: found.id, name: fullName(found.first, found.last), by: 'email' }
    }
    const name = normalizeKey(fullName(person.firstName, person.lastName))
    if (!name) return null
    const found = reader
      .select({
        id: schema.person.id,
        first: schema.person.first_name,
        last: schema.person.last_name
      })
      .from(schema.person)
      .all()
      .find((row) => normalizeKey(fullName(row.first, row.last)) === name)
    return found ? { id: found.id, name: fullName(found.first, found.last), by: 'name' } : null
  }

  /** What writing the party would match, for the preview */
  matches(party: EInvoicePartyInput): Pick<EInvoicePartyPreview, 'company' | 'persons'> {
    const company = this.findCompany(party)
    const memberIds = company
      ? new Set(
          db
            .select({ personId: schema.company_member.person_id })
            .from(schema.company_member)
            .where(eq(schema.company_member.company_id, company.id))
            .all()
            .map((row) => row.personId)
        )
      : new Set<number>()
    return {
      company,
      persons: party.persons.map((person) => {
        const match = this.findPerson(person)
        return { match, isMember: match !== null && memberIds.has(match.id) }
      })
    }
  }

  /** Creates or completes the company, its people and their membership, in one transaction */
  apply(party: EInvoicePartyInput): EInvoicePartyResult {
    const result = db.transaction((tx) => this.write(tx, party))
    contactAddressEvents.emit('saved')
    return result
  }

  private write(tx: Tx, party: EInvoicePartyInput): EInvoicePartyResult {
    const result: EInvoicePartyResult = {
      companyId: 0,
      companyCreated: false,
      companyUpdated: false,
      personsCreated: 0,
      personsUpdated: 0,
      membersAdded: 0
    }

    // ---- Company ----
    const companyValues = {
      vat_id: party.vatId,
      tax_number: party.taxNumber,
      commercial_register_no: party.commercialRegisterNo,
      register_court: party.registerCourt
    }
    const match = this.findCompany(party, tx)
    if (match === null) {
      const created = tx
        .insert(schema.company)
        .values({
          name: party.name,
          ...companyValues,
          address_id: this.completeAddress(tx, null, party.address).id,
          contact_id: this.completeContact(tx, null, party.email, party.phone).id,
          bank_id: this.findOrInsertBank(tx, party.bank)
        })
        .returning({ id: schema.company.id })
        .get()
      result.companyId = created.id
      result.companyCreated = true
    } else {
      const row = tx.select().from(schema.company).where(eq(schema.company.id, match.id)).get()
      if (!row) throw new Error(`Firma ${match.id} nicht gefunden`)
      result.companyId = row.id
      const address = this.completeAddress(tx, row.address_id, party.address)
      const contact = this.completeContact(tx, row.contact_id, party.email, party.phone)
      const changes = emptyOnly(row, {
        ...companyValues,
        address_id: address.id,
        contact_id: contact.id,
        bank_id: row.bank_id === null ? this.findOrInsertBank(tx, party.bank) : null
      })
      if (hasValues(changes)) {
        tx.update(schema.company)
          .set({ ...changes, updated_at: sql`datetime('now')` })
          .where(eq(schema.company.id, row.id))
          .run()
      }
      result.companyUpdated = hasValues(changes) || address.changed || contact.changed
    }

    // ---- People ----
    for (const person of party.persons) {
      const found = this.findPerson(person, tx)
      let personId: number
      if (found === null) {
        personId = tx
          .insert(schema.person)
          .values({
            first_name: person.firstName,
            last_name: person.lastName,
            contact_id: this.completeContact(tx, null, person.email, person.phone).id
          })
          .returning({ id: schema.person.id })
          .get().id
        result.personsCreated++
      } else {
        personId = found.id
        const row = tx.select().from(schema.person).where(eq(schema.person.id, found.id)).get()
        if (!row) throw new Error(`Person ${found.id} nicht gefunden`)
        const contact = this.completeContact(tx, row.contact_id, person.email, person.phone)
        if (row.contact_id === null && contact.id !== null) {
          tx.update(schema.person)
            .set({ contact_id: contact.id, updated_at: sql`datetime('now')` })
            .where(eq(schema.person.id, row.id))
            .run()
        }
        if (contact.changed) result.personsUpdated++
      }

      const member = tx
        .select()
        .from(schema.company_member)
        .where(
          and(
            eq(schema.company_member.company_id, result.companyId),
            eq(schema.company_member.person_id, personId)
          )
        )
        .get()
      if (!member) {
        tx.insert(schema.company_member)
          .values({ company_id: result.companyId, person_id: personId, role: person.role || null })
          .run()
        result.membersAdded++
      } else if (!member.role && person.role) {
        tx.update(schema.company_member)
          .set({ role: person.role })
          .where(eq(schema.company_member.id, member.id))
          .run()
      }
    }
    return result
  }

  /** Fills the empty fields of an existing address, or creates one */
  private completeAddress(
    tx: Tx,
    addressId: number | null,
    address: EInvoicePartyInput['address']
  ): { id: number | null; changed: boolean } {
    const values = addressValues(address)
    if (addressId === null) {
      if (!hasValues(values)) return { id: null, changed: false }
      const id = tx
        .insert(schema.address)
        .values(values as typeof schema.address.$inferInsert)
        .returning({ id: schema.address.id })
        .get().id
      return { id, changed: true }
    }
    const row = tx.select().from(schema.address).where(eq(schema.address.id, addressId)).get()
    if (!row) return { id: addressId, changed: false }
    const changes = emptyOnly(row, values)
    if (!hasValues(changes)) return { id: addressId, changed: false }
    tx.update(schema.address).set(changes).where(eq(schema.address.id, addressId)).run()
    return { id: addressId, changed: true }
  }

  /**
   * Fills the empty fields of an existing contact, or creates one. An e-mail address
   * other than the stored primary one becomes a further address of the contact.
   */
  private completeContact(
    tx: Tx,
    contactId: number | null,
    email: string,
    phone: string
  ): { id: number | null; changed: boolean } {
    const values = { email: email.trim(), phone: phone.trim() }
    if (contactId === null) {
      if (!hasValues(values)) return { id: null, changed: false }
      const id = tx
        .insert(schema.contact)
        .values(values)
        .returning({ id: schema.contact.id })
        .get().id
      return { id, changed: true }
    }
    const row = tx.select().from(schema.contact).where(eq(schema.contact.id, contactId)).get()
    if (!row) return { id: contactId, changed: false }
    const changes = emptyOnly(row, values)
    if (hasValues(changes)) {
      tx.update(schema.contact).set(changes).where(eq(schema.contact.id, contactId)).run()
    }
    const further = normalizeEmail(email)
    let added = false
    if (further && !changes.email && normalizeEmail(row.email) !== further) {
      const known = tx
        .select({ id: schema.contact_email.id, position: schema.contact_email.position })
        .from(schema.contact_email)
        .where(eq(schema.contact_email.contact_id, contactId))
        .all()
      const exists = tx
        .select({ id: schema.contact_email.id })
        .from(schema.contact_email)
        .where(
          and(
            eq(schema.contact_email.contact_id, contactId),
            eq(schema.contact_email.email, further)
          )
        )
        .get()
      if (!exists) {
        const position = known.reduce((last, entry) => Math.max(last, entry.position + 1), 0)
        tx.insert(schema.contact_email)
          .values({ contact_id: contactId, email: further, position })
          .run()
        added = true
      }
    }
    return { id: contactId, changed: hasValues(changes) || added }
  }

  /** The bank account with this IBAN, created if the app does not know it yet */
  private findOrInsertBank(tx: Tx, bank: EInvoicePartyInput['bank']): number | null {
    const iban = bank.iban.replace(/\s+/g, '').toUpperCase()
    if (!iban) return null
    const existing = tx
      .select({ id: schema.bank.id })
      .from(schema.bank)
      .where(sql`upper(replace(${schema.bank.iban}, ' ', '')) = ${iban}`)
      .get()
    if (existing) return existing.id
    return tx
      .insert(schema.bank)
      .values({
        iban,
        bic: bank.bic.replace(/\s+/g, '').toUpperCase(),
        account_holder: bank.accountHolder
      })
      .returning({ id: schema.bank.id })
      .get().id
  }
}
