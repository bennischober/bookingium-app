import { injectable } from 'tsyringe'
import { listGenres } from '../repositories/genres'

/** The known genre tags (#152), for the tag pickers of venues, companies and bands */
@injectable()
export class GenreService {
  list(): string[] {
    return listGenres()
  }
}
