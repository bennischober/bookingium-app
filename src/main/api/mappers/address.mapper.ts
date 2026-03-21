import { address } from '../../db/schema'
import type { AddressDto } from '../schemas/address.schema'

type AddressEntity = typeof address.$inferSelect

export class AddressMapper {
  static toDto(entity: AddressEntity | null | undefined): AddressDto | null {
    if (!entity) return null

    return {
      id: entity.id,
      street: entity.street,
      streetNumber: entity.street_number,
      addressSuffix: entity.address_suffix ?? '',
      zipCode: entity.zip_code,
      city: entity.city,
      state: entity.state,
      country: entity.country,
      countryCode: entity.country_code
    }
  }
}
