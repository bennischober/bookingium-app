import { initTRPC } from '@trpc/server'
import { container } from 'tsyringe'
import { MapService } from '../../services/MapService'
import { MapDataDto, MapDataInput } from '../schemas/map.schema'

const t = initTRPC.create()
const mapService = container.resolve(MapService)

export const mapRouter = t.router({
  getData: t.procedure
    .input(MapDataInput)
    .output(MapDataDto)
    .query(async ({ input }) => mapService.getData(input))
})
