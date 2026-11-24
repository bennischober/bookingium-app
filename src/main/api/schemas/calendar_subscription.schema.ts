import { z } from 'zod'

// #53: subscribed calendars (ICS/webcal), shown read-only in the calendar

export const SUBSCRIPTION_COLORS = [
  '#0ea5e9',
  '#8b5cf6',
  '#f97316',
  '#14b8a6',
  '#ec4899',
  '#84cc16',
  '#64748b'
] as const

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const CreateCalendarSubscriptionInput = z.object({
  url: z.string().trim().min(1).max(2000),
  // Empty: the feed's own name (X-WR-CALNAME), else the host
  name: z.string().trim().max(200).optional()
})
export type CreateCalendarSubscriptionInput = z.infer<typeof CreateCalendarSubscriptionInput>

export const UpdateCalendarSubscriptionInput = z.object({
  id: z.number().int(),
  name: z.string().trim().min(1).max(200).optional(),
  color: Color.optional(),
  enabled: z.boolean().optional()
})
export type UpdateCalendarSubscriptionInput = z.infer<typeof UpdateCalendarSubscriptionInput>

export const CalendarSubscriptionDto = z.object({
  id: z.number(),
  name: z.string(),
  url: z.string(),
  color: z.string(),
  enabled: z.boolean(),
  // When this computer last fetched it successfully (UTC "YYYY-MM-DD HH:MM:SS"), null before
  fetchedAt: z.string().nullable(),
  // The last attempt's error, '' when it worked
  error: z.string(),
  // Entries (VEVENTs) in the last fetched feed
  eventCount: z.number()
})
export type CalendarSubscriptionDto = z.infer<typeof CalendarSubscriptionDto>

export const SubscribedEntriesInput = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
})
export type SubscribedEntriesInput = z.infer<typeof SubscribedEntriesInput>

export const SubscribedEntryDto = z.object({
  key: z.string(),
  subscriptionId: z.number(),
  subscriptionName: z.string(),
  color: z.string(),
  title: z.string(),
  location: z.string(),
  description: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  cancelled: z.boolean()
})
export type SubscribedEntryDto = z.infer<typeof SubscribedEntryDto>

/** #53: the check of the Bookingium file's public address */
export const ShareLinkCheckDto = z.object({
  // The share link as entered and the address calendar apps subscribe to
  link: z.string(),
  subscribeUrl: z.string(),
  provider: z.enum(['onedrive', 'sharepoint', 'dropbox', 'googledrive', 'other']),
  ok: z.boolean(),
  // Entries in the fetched file and when it was written (ISO), when it is the Bookingium file
  events: z.number(),
  writtenAt: z.string().nullable(),
  // The fetched file is older than the last write here (the cloud has not caught up yet)
  stale: z.boolean(),
  error: z.string()
})
export type ShareLinkCheckDto = z.infer<typeof ShareLinkCheckDto>
