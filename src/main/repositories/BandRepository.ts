import { injectable } from 'tsyringe'
import { db } from '../db'
import { schema } from '../db/schema'

@injectable()
export class BandRepository {
  async getAll() {
    return await db.select().from(schema.band)
  }
}
