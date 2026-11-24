import type { SubscribedEntryDto } from '../../../../main/api/schemas/calendar_subscription.schema'

function addDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return next.toISOString().slice(0, 10)
}

/** #53: subscribed entries by day (yyyy-MM-dd), an entry over several days on each of them */
export function subscribedByDay(
  entries: SubscribedEntryDto[],
  from: string,
  to: string
): Map<string, SubscribedEntryDto[]> {
  const byDay = new Map<string, SubscribedEntryDto[]>()
  for (const entry of entries) {
    let day = entry.startDate < from ? from : entry.startDate
    const last = entry.endDate > to ? to : entry.endDate
    for (let guard = 0; day <= last && guard < 400; guard++, day = addDay(day)) {
      byDay.set(day, [...(byDay.get(day) ?? []), entry])
    }
  }
  return byDay
}
