import { inject, injectable } from 'tsyringe'
import { readFile } from 'fs/promises'
import { basename } from 'path'
import { MarketingRepository } from '../repositories/MarketingRepository'
import { parseAtlasText, type Atlas } from '../marketing/atlasFormat'
import {
  MarketingCategory,
  type LinkMarketingContactInput,
  type MarketingFileDto,
  type MarketingImportInput,
  type MarketingImportResultDto,
  type SetMarketingPickedInput,
  type UpdateMarketingItemInput,
  type UpdateMarketingItemsInput
} from '../api/schemas/marketing.schema'

/** Atlas files are a few hundred KB; anything far larger is not one */
const MAX_FILE_BYTES = 20 * 1024 * 1024

/** Marketing-Atlas of a band: reading atlas files, importing them, keeping the status */
@injectable()
export class MarketingService {
  constructor(@inject(MarketingRepository) private repository: MarketingRepository) {}

  overview(bandId: number) {
    const items = this.repository.items(bandId)
    return {
      atlas: this.repository.atlas(bandId) ?? null,
      items,
      candidates: this.repository.candidatesOf(items),
      undo: this.repository.undoInfo(bandId)
    }
  }

  bandName(bandId: number): string | null {
    return this.repository.bandName(bandId)
  }

  async readAtlas(path: string): Promise<Atlas> {
    const buffer = await readFile(path)
    if (buffer.byteLength > MAX_FILE_BYTES) {
      throw new Error('Die Datei ist zu groß für einen Marketing-Atlas.')
    }
    return parseAtlasText(buffer.toString('utf8'))
  }

  /** What a picked file holds: band, stand, entries per tab and the suggested working list */
  async inspect(bandId: number, path: string): Promise<MarketingFileDto> {
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
      total: atlas.items.length,
      ...this.repository.compare(bandId, atlas)
    }
  }

  async importAtlas(input: MarketingImportInput): Promise<MarketingImportResultDto> {
    const atlas = await this.readAtlas(input.path)
    return this.repository.importAtlas(input.bandId, atlas, basename(input.path), {
      picked: input.picked,
      createContacts: input.createContacts,
      contactLists: input.contactLists,
      renames: input.renames
    })
  }

  setPicked(input: SetMarketingPickedInput) {
    return this.repository.setPicked(input.bandId, input.ids, input.picked, input.createContacts)
  }

  update(input: UpdateMarketingItemInput): void {
    this.repository.update(input)
  }

  updateMany(input: UpdateMarketingItemsInput): number {
    return this.repository.updateMany(input.bandId, input.ids, input.status)
  }

  linkContact(input: LinkMarketingContactInput): void {
    this.repository.linkContact(input.id, { companyId: input.companyId, venueId: input.venueId })
  }

  undoImport(bandId: number) {
    return this.repository.undoImport(bandId)
  }

  linksOf(target: { companyId?: number; venueId?: number }) {
    return this.repository.linksOf(target)
  }
}
