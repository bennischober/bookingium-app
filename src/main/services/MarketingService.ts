import { inject, injectable } from 'tsyringe'
import { readFile } from 'fs/promises'
import { basename } from 'path'
import { MarketingRepository } from '../repositories/MarketingRepository'
import { parseAtlasText, type Atlas } from '../marketing/atlasFormat'
import {
  MarketingCategory,
  type MarketingFileDto,
  type MarketingImportInput,
  type MarketingImportResultDto,
  type UpdateMarketingItemInput
} from '../api/schemas/marketing.schema'

/** Atlas files are a few hundred KB; anything far larger is not one */
const MAX_FILE_BYTES = 20 * 1024 * 1024

/** Marketing-Atlas of a band: reading atlas files, importing them, keeping the status */
@injectable()
export class MarketingService {
  constructor(@inject(MarketingRepository) private repository: MarketingRepository) {}

  overview(bandId: number) {
    return { atlas: this.repository.atlas(bandId) ?? null, items: this.repository.items(bandId) }
  }

  async readAtlas(path: string): Promise<Atlas> {
    const buffer = await readFile(path)
    if (buffer.byteLength > MAX_FILE_BYTES) {
      throw new Error('Die Datei ist zu groß für einen Marketing-Atlas.')
    }
    return parseAtlasText(buffer.toString('utf8'))
  }

  /** What a picked file holds: band, stand and entries per tab */
  async inspect(path: string): Promise<MarketingFileDto> {
    const atlas = await this.readAtlas(path)
    const counts = MarketingCategory.options
      .map((category) => ({
        category,
        count: atlas.items.filter((item) => item.category === category).length
      }))
      .filter((entry) => entry.count > 0)
    return {
      path,
      fileName: basename(path),
      band: atlas.band,
      stand: atlas.stand,
      counts,
      total: atlas.items.length
    }
  }

  async importAtlas(input: MarketingImportInput): Promise<MarketingImportResultDto> {
    const atlas = await this.readAtlas(input.path)
    return this.repository.importAtlas(input.bandId, atlas, basename(input.path), {
      contacts: input.contacts,
      contactLists: input.contactLists
    })
  }

  update(input: UpdateMarketingItemInput): void {
    this.repository.update(input)
  }

  linkContact(id: number): void {
    this.repository.linkContact(id)
  }

  linksOf(target: { companyId?: number; venueId?: number }) {
    return this.repository.linksOf(target)
  }
}
