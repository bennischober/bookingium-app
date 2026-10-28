// D3: an archived event (deal memo) is out of every working view but still there - its
// itinerary, follow-ups, documents, mails and the link from its invoices all survive.
//
// One predicate, imported by every read path, so a surface cannot silently forget it: a missed
// filter does not error, an archived gig just shows up somewhere.
import { isNotNull, isNull, type SQL } from 'drizzle-orm'
import { schema } from '../db/schema'

/** Rows that are not archived - the default of every list, feed and search */
export function notArchived(): SQL {
  return isNull(schema.deal_memo.archived_at)
}

/** Rows that are archived - only the archive view asks for these */
export function onlyArchived(): SQL {
  return isNotNull(schema.deal_memo.archived_at)
}
