import { localIsoDate } from '@/lib/followUps'

/** Classes of a list row whose show is over: lighter, so upcoming shows stand out */
export const PAST_EVENT_ROW_CLASS = 'bg-muted/30 text-muted-foreground'

/** A show is over once its day has passed; today's show still counts as upcoming */
export function isPastEvent(date: string | null | undefined, today: string = localIsoDate()) {
  if (!date) return false
  return date.slice(0, 10) < today
}

/** "Club, Stadt" for a list row; "–" when neither is known */
export function eventPlace(event: { venueName: string | null; venueCity?: string | null }) {
  const parts = [event.venueName, event.venueCity].filter((part) => part && part.trim())
  return parts.length > 0 ? parts.join(', ') : '–'
}
