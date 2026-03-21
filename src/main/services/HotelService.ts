import { injectable, inject } from 'tsyringe'
import { HotelRepository } from '../repositories/HotelRepository'
import type { CreateHotelInput, UpdateHotelInput } from '../api/schemas/hotel.schema'
import { PaginationInput } from '../api/schemas/base.schema'

@injectable()
export class HotelService {
  constructor(@inject(HotelRepository) private hotelRepository: HotelRepository) {}

  async getAllHotels() {
    return await this.hotelRepository.getAll()
  }

  async getAllHotelsPaginated(pagination: PaginationInput) {
    return await this.hotelRepository.getAllPaginated(pagination)
  }

  async getHotelById(id: number) {
    return await this.hotelRepository.getById(id)
  }

  async createHotel(input: CreateHotelInput) {
    return await this.hotelRepository.create(input)
  }

  async updateHotel(input: UpdateHotelInput) {
    return await this.hotelRepository.update(input)
  }

  async deleteHotel(id: number) {
    await this.hotelRepository.delete(id)
  }
}
