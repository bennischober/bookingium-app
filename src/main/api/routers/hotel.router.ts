import { z } from 'zod'
import { initTRPC } from '@trpc/server'
import { container } from 'tsyringe'
import { HotelService } from '../../services/HotelService'
import { HotelMapper } from '../mappers/hotel.mapper'
import { PaginationInput } from '../schemas/base.schema'
import { CreateHotelInput, UpdateHotelInput } from '../schemas/hotel.schema'

const t = initTRPC.create()
const hotelService = container.resolve(HotelService)

export const hotelRouter = t.router({
  getAll: t.procedure.query(async () => {
    const hotels = await hotelService.getAllHotels()
    return HotelMapper.toDtoList(hotels)
  }),

  /** Lightweight list for combobox pickers. */
  getListItems: t.procedure.query(async () => {
    const hotels = await hotelService.getAllHotels()
    return HotelMapper.toListItemList(hotels)
  }),

  getAllPaginated: t.procedure.input(PaginationInput).query(async ({ input }) => {
    const result = await hotelService.getAllHotelsPaginated(input)
    return {
      ...result,
      items: HotelMapper.toDtoList(result.items)
    }
  }),

  getById: t.procedure.input(z.number()).query(async ({ input }) => {
    const hotel = await hotelService.getHotelById(input)
    return hotel ? HotelMapper.toDto(hotel) : null
  }),

  create: t.procedure.input(CreateHotelInput).mutation(async ({ input }) => {
    const hotel = await hotelService.createHotel(input)
    return HotelMapper.toDto(hotel)
  }),

  update: t.procedure.input(UpdateHotelInput).mutation(async ({ input }) => {
    const hotel = await hotelService.updateHotel(input)
    return HotelMapper.toDto(hotel)
  }),

  delete: t.procedure.input(z.number()).mutation(async ({ input }) => {
    await hotelService.deleteHotel(input)
  })
})
