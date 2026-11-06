// #122: "Event anlegen" from a booking request in the reader. What the new event starts
// with is read from the mail here (pure, unit-tested); the wizard shows it for checking.

/** A record the sender's address belongs to, as `mailLink.senderOwners` returns it */
export type SenderOwner = { entityType: string; entityId: number }

export type EventPrefill = {
  name: string
  /** yyyy-MM-dd, '' when the mail names no date from today on */
  date: string
  venueId: number | null
  loProPersonId: number | null
  loProCompanyId: number | null
}

/** "AW: WG: Re[2]: Anfrage 14.03." -> "Anfrage 14.03." */
export function eventNameFromSubject(subject: string): string {
  let name = subject.replace(/\s+/g, ' ').trim()
  const prefix = /^(?:re|aw|antw|fwd?|wg|sv|vs)(?:\s*\[\d+\]|\s*\(\d+\))?\s*:\s*/i
  while (prefix.test(name)) name = name.replace(prefix, '')
  return name
}

const MONTHS: Record<string, number> = {
  januar: 1,
  jänner: 1,
  january: 1,
  jan: 1,
  februar: 2,
  february: 2,
  feb: 2,
  märz: 3,
  maerz: 3,
  march: 3,
  mär: 3,
  mar: 3,
  april: 4,
  apr: 4,
  mai: 5,
  may: 5,
  juni: 6,
  june: 6,
  jun: 6,
  juli: 7,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  oktober: 10,
  october: 10,
  okt: 10,
  oct: 10,
  november: 11,
  nov: 11,
  dezember: 12,
  december: 12,
  dez: 12,
  dec: 12
}
const MONTH_NAMES = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|')

// Each pattern names the groups it fills; one without a year takes the next such day
const PATTERNS: RegExp[] = [
  // 2027-03-14
  /(?<![\d.])(?<year>\d{4})-(?<month>\d{1,2})-(?<day>\d{1,2})(?![\d-])/giu,
  // 14.03.2027, 14.3.27, and the first day of a range: 14.-15.03.2027
  /(?<![\d.])(?<day>\d{1,2})\.(?:\s*[-–]\s*\d{1,2}\.)?\s?(?<month>\d{1,2})\.(?:\s?(?<year>\d{4}|\d{2}))?(?![\d])/giu,
  // 14. März 2027, 14 March 2027, 14.-15. März
  new RegExp(
    String.raw`(?<![\d.])(?<day>\d{1,2})\.?(?:\s*[-–]\s*\d{1,2}\.?)?\s+(?<name>${MONTH_NAMES})\.?(?:\s+(?<year>\d{4}))?(?![\p{L}\d])`,
    'giu'
  ),
  // March 14, 2027 / March 14th
  new RegExp(
    String.raw`(?<![\p{L}])(?<name>${MONTH_NAMES})\.?\s+(?<day>\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(?<year>\d{4}))?(?![\d.])`,
    'giu'
  )
]

const iso = (year: number, month: number, day: number): string | null => {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null
  if (date.getUTCDate() !== day) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Every date one text names, with where it stands, read as a calendar day */
function datesIn(text: string, today: string): { index: number; date: string }[] {
  const thisYear = Number(today.slice(0, 4))
  const found: { index: number; date: string }[] = []
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const groups = match.groups ?? {}
      const day = Number(groups.day)
      const month = groups.name ? MONTHS[groups.name.toLowerCase()] : Number(groups.month)
      if (!month || !day) continue
      let date: string | null
      if (groups.year) {
        const year = groups.year.length === 2 ? 2000 + Number(groups.year) : Number(groups.year)
        date = iso(year, month, day)
      } else {
        // "am 14.3.": this year's, or next year's once it is past
        const sameYear = iso(thisYear, month, day)
        date = sameYear && sameYear >= today ? sameYear : iso(thisYear + 1, month, day)
      }
      if (date) found.push({ index: match.index ?? 0, date })
    }
  }
  return found.sort((a, b) => a.index - b.index)
}

/**
 * The first date from today on, in the subject first, then in the body. Dates
 * already past (the quoted "Am 03.11.2026 schrieb …", an old tour) are no event date.
 */
export function findEventDate(texts: (string | null | undefined)[], today: string): string {
  for (const text of texts) {
    if (!text) continue
    const next = datesIn(text, today).find((found) => found.date >= today)
    if (next) return next.date
  }
  return ''
}

/** The one record of a type the address belongs to; none when there are several */
const onlyOne = (owners: readonly SenderOwner[], type: string): number | null => {
  const ids = owners.filter((owner) => owner.entityType === type)
  return ids.length === 1 ? ids[0].entityId : null
}

/**
 * What the wizard opens with: the subject as name, the date, and the sender as LoPro
 * (person and/or company) or as the venue when their address belongs to one.
 */
export function eventPrefillFromMail(input: {
  subject: string
  text: string | null
  senderOwners: readonly SenderOwner[]
  today: string
}): EventPrefill {
  return {
    name: eventNameFromSubject(input.subject),
    date: findEventDate([input.subject, input.text], input.today),
    venueId: onlyOne(input.senderOwners, 'venue'),
    loProPersonId: onlyOne(input.senderOwners, 'person'),
    loProCompanyId: onlyOne(input.senderOwners, 'company')
  }
}
