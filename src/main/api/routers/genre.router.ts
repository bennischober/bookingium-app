import { initTRPC } from '@trpc/server'
import { container } from 'tsyringe'
import { GenreService } from '../../services/GenreService'

const t = initTRPC.create()
const genreService = container.resolve(GenreService)

export const genreRouter = t.router({
  /** Genres some venue, company or band uses, sorted */
  list: t.procedure.query(() => genreService.list())
})
