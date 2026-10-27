import { contact } from '../../db/schema'
import type { ContactDto } from '../schemas/contact.schema'

/** Repositories read a contact with its further addresses (contactEmails.ts) */
export type ContactEntity = typeof contact.$inferSelect & { other_emails: string[] }

export class ContactMapper {
  static toDto(entity: ContactEntity | null | undefined): ContactDto | null {
    if (!entity) return null

    return {
      id: entity.id,
      email: entity.email,
      otherEmails: entity.other_emails,
      phone: entity.phone ?? '',
      mobilePhone: entity.mobile_phone ?? '',
      homepage: entity.homepage ?? '',
      noAdvertising: entity.no_advertising
    }
  }
}
