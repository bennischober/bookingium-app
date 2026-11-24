import { inject, injectable } from 'tsyringe'
import { removeOwnerFolder } from '../utils/documentStorage'
import { ReleaseRepository } from '../repositories/ReleaseRepository'
import type { PaginationInput } from '../api/schemas/base.schema'
import type {
  CreateReleaseInput,
  MoveTrackInput,
  SaveProductData,
  SaveReleaseCreditsInput,
  SaveTrackData,
  UpdateReleaseInput
} from '../api/schemas/release.schema'
import { normalizeCode } from '../release/codes'

/** Releases (#289): the label copy of a record */
@injectable()
export class ReleaseService {
  constructor(@inject(ReleaseRepository) private releases: ReleaseRepository) {}

  getAllPaginated(pagination: PaginationInput) {
    return this.releases.getAllPaginated(pagination)
  }

  listAll() {
    return this.releases.listAll()
  }

  listByBand(bandId: number) {
    return this.releases.listByBand(bandId)
  }

  /** The releases a company put out as their label */
  listByLabelCompany(companyId: number) {
    return this.releases.listByLabelCompany(companyId)
  }

  getDetail(id: number) {
    return this.releases.getDetail(id)
  }

  async create(input: CreateReleaseInput) {
    const id = await this.releases.create(input)
    return this.requireDetail(id)
  }

  async update(input: UpdateReleaseInput) {
    await this.requireRelease(input.id)
    await this.releases.update(input)
    return this.requireDetail(input.id)
  }

  async delete(id: number) {
    await this.releases.delete(id)
    await removeOwnerFolder('release', id).catch((error) => console.error(error))
  }

  async saveCredits(input: SaveReleaseCreditsInput) {
    await this.requireRelease(input.releaseId)
    await this.releases.saveCredits(input.releaseId, input.contributors)
    return this.requireDetail(input.releaseId)
  }

  async saveTrack(input: SaveTrackData) {
    await this.requireRelease(input.releaseId)
    if (input.id !== null) await this.requireTrackOf(input.id, input.releaseId)
    await this.releases.saveTrack({
      ...input,
      isrc: normalizeCode(input.isrc),
      videoIsrc: normalizeCode(input.videoIsrc)
    })
    return this.requireDetail(input.releaseId)
  }

  async deleteTrack(id: number) {
    const track = await this.releases.getTrack(id)
    if (!track) throw new Error('Track nicht gefunden')
    await this.releases.deleteTrack(id, track.release_id)
    return this.requireDetail(track.release_id)
  }

  async moveTrack(input: MoveTrackInput) {
    const track = await this.releases.getTrack(input.id)
    if (!track) throw new Error('Track nicht gefunden')
    await this.releases.moveTrack(track, input.direction)
    return this.requireDetail(track.release_id)
  }

  async saveProduct(input: SaveProductData) {
    await this.requireRelease(input.releaseId)
    if (input.id !== null) {
      const product = await this.releases.getProduct(input.id)
      if (!product || product.release_id !== input.releaseId)
        throw new Error('Produkt nicht gefunden')
    }
    const known = await this.releases.trackIdsOf(
      input.releaseId,
      input.tracks.map((t) => t.trackId)
    )
    if (input.tracks.some((t) => !known.has(t.trackId)))
      throw new Error('Ein Track der Trackliste gehört nicht zu diesem Release')
    await this.releases.saveProduct({ ...input, upc: normalizeCode(input.upc) })
    return this.requireDetail(input.releaseId)
  }

  async deleteProduct(id: number) {
    const product = await this.releases.getProduct(id)
    if (!product) throw new Error('Produkt nicht gefunden')
    await this.releases.deleteProduct(id, product.release_id)
    return this.requireDetail(product.release_id)
  }

  private async requireRelease(id: number) {
    const release = await this.releases.getById(id)
    if (!release) throw new Error('Release nicht gefunden')
    return release
  }

  private async requireTrackOf(trackId: number, releaseId: number) {
    const track = await this.releases.getTrack(trackId)
    if (!track || track.release_id !== releaseId) throw new Error('Track nicht gefunden')
    return track
  }

  private async requireDetail(id: number) {
    const detail = await this.releases.getDetail(id)
    if (!detail) throw new Error('Release nicht gefunden')
    return detail
  }
}
