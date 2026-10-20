import { contact } from '../../db/schema'
import type { ContactDto } from '../schemas/contact.schema'

type ContactEntity = typeof contact.$inferSelect

export class ContactMapper {
  static toDto(entity: ContactEntity | null | undefined): ContactDto | null {
    if (!entity) return null

    return {
      id: entity.id,
      email: entity.email,
      phone: entity.phone ?? '',
      mobilePhone: entity.mobile_phone ?? '',
      homepage: entity.homepage ?? '',
      noAdvertising: entity.no_advertising
    }
  }
}
