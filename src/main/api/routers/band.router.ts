import { initTRPC } from '@trpc/server'
import { container } from 'tsyringe'
import { BandService } from '../../services/BandService'

const t = initTRPC.create()

const bandService = container.resolve(BandService)

export const bandRouter = t.router({
  getAll: t.procedure.query(async () => {
    return await bandService.getAllBands()
  })
})