import { injectable, inject } from 'tsyringe'
import {
  RecipientLookupRepository,
  mailCandidates
} from '../repositories/recipientLookupRepository'
import { mergeRecipients, type RecipientCandidate } from '../mail/recipientLookup'

/**
 * The compose field's recipient lookup.
 *
 * Two sources with different homes: the app's own records (persons, companies, venues) live in the
 * app database, which the dependency-free mail core cannot read; the addresses it remembers from
 * message headers live in the mail store, which the repository cannot reach. This service is the one
 * place that sees both, so the merge and its ranking stay out of the router.
 */
@injectable()
export class RecipientLookupService {
  constructor(@inject(RecipientLookupRepository) private repo: RecipientLookupRepository) {}

  /**
   * @param query      what the user typed (at least two characters; the caller checks)
   * @param fromMail   the mail store's own suggestions for the same query
   */
  lookup(
    query: string,
    fromMail: readonly { name: string; email: string }[]
  ): RecipientCandidate[] {
    const needle = query.trim()
    if (needle.length < 2) return []
    return mergeRecipients([...this.repo.loadCandidates(), ...mailCandidates(fromMail)], needle)
  }
}
