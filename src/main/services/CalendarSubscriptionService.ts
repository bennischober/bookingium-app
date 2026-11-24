import { singleton, inject } from 'tsyringe'
import { CalendarSubscriptionRepository } from '../repositories/CalendarSubscriptionRepository'
import type { CalendarSubscriptionRow } from '../repositories/CalendarSubscriptionRepository'
import { FeedFetcher } from './FeedFetcher'
import { entriesBetween, parseFeed, type ParsedFeed } from '../calendar/subscribed'
import { parseFeedAddress } from '../calendar/shareLink'
import {
  SUBSCRIPTION_COLORS,
  type CalendarSubscriptionDto,
  type CreateCalendarSubscriptionInput,
  type SubscribedEntryDto,
  type UpdateCalendarSubscriptionInput
} from '../api/schemas/calendar_subscription.schema'

// Google refreshes subscriptions every few hours; half an hour is plenty here
const REFRESH_INTERVAL_MS = 30 * 60_000

/**
 * #53: calendars subscribed by address (ICS/webcal: Google, iCloud, Outlook, ...). Fetched on
 * start, every half hour and on demand; each computer fetches for itself and keeps the last
 * good feed, so the calendar still shows it offline. Entries are read-only in Bookingium.
 */
// One instance: it owns the timer, the fetches in flight and the parsed feeds
@singleton()
export class CalendarSubscriptionService {
  private timer: NodeJS.Timeout | null = null
  private inFlight = new Map<number, Promise<void>>()
  // Parsed feeds by subscription, valid while the cached text is the same
  private parsed = new Map<number, { ics: string; feed: ParsedFeed | null }>()

  constructor(
    @inject(CalendarSubscriptionRepository) private repository: CalendarSubscriptionRepository,
    @inject(FeedFetcher) private fetcher: FeedFetcher
  ) {}

  /** Fetches all now and then every half hour */
  start(): void {
    if (this.timer) return
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private feedOf(row: CalendarSubscriptionRow): ParsedFeed | null {
    const ics = row.ics ?? ''
    if (!ics) return null
    const known = this.parsed.get(row.subscription.id)
    if (known && known.ics === ics) return known.feed
    let feed: ParsedFeed | null = null
    try {
      feed = parseFeed(ics)
    } catch {
      // Only good feeds are cached; one that stopped parsing (a newer ical.js) shows nothing
    }
    this.parsed.set(row.subscription.id, { ics, feed })
    return feed
  }

  private toDto(row: CalendarSubscriptionRow): CalendarSubscriptionDto {
    return {
      id: row.subscription.id,
      name: row.subscription.name,
      url: row.subscription.url,
      color: row.subscription.color,
      enabled: row.subscription.enabled,
      fetchedAt: row.fetched_at ?? null,
      error: row.error ?? '',
      eventCount: this.feedOf(row)?.eventCount ?? 0
    }
  }

  list(): CalendarSubscriptionDto[] {
    return this.repository.listAll().map((row) => this.toDto(row))
  }

  /** Fetches the address first: one that is not a calendar is not added */
  async create(input: CreateCalendarSubscriptionInput): Promise<CalendarSubscriptionDto> {
    const address = parseFeedAddress(input.url)
    if (!address) throw new Error('Keine gültige Adresse (https://… oder webcal://…).')
    const ics = await this.fetcher.text(input.url)
    const feed = parseFeed(ics)
    const used = new Set(this.repository.listAll().map((row) => row.subscription.color))
    const color =
      SUBSCRIPTION_COLORS.find((c) => !used.has(c)) ??
      SUBSCRIPTION_COLORS[used.size % SUBSCRIPTION_COLORS.length]
    const created = this.repository.create({
      name: input.name?.trim() || feed.name || address.hostname,
      url: input.url.trim(),
      color
    })
    this.repository.saveFetched(created.id, ics)
    const row = this.repository.findById(created.id)
    if (!row) throw new Error('Abo konnte nicht gespeichert werden.')
    return this.toDto(row)
  }

  update(input: UpdateCalendarSubscriptionInput): CalendarSubscriptionDto | null {
    const { id, ...data } = input
    if (!this.repository.findById(id)) return null
    this.repository.update(id, data)
    const row = this.repository.findById(id)
    // Switched on again: fetch it, it may have been off for a while
    if (row && data.enabled === true) void this.refreshOne(row)
    return row ? this.toDto(row) : null
  }

  remove(id: number): boolean {
    this.parsed.delete(id)
    return this.repository.delete(id)
  }

  private refreshOne(row: CalendarSubscriptionRow): Promise<void> {
    const id = row.subscription.id
    const running = this.inFlight.get(id)
    if (running) return running
    const run = (async () => {
      try {
        const ics = await this.fetcher.text(row.subscription.url)
        parseFeed(ics)
        this.repository.saveFetched(id, ics)
      } catch (error) {
        this.repository.saveError(id, error instanceof Error ? error.message : String(error))
      } finally {
        this.inFlight.delete(id)
      }
    })()
    this.inFlight.set(id, run)
    return run
  }

  /** Fetches one subscription or all switched-on ones; errors are kept per subscription */
  async refresh(id?: number): Promise<CalendarSubscriptionDto[]> {
    const rows = this.repository
      .listAll()
      .filter((row) => (id === undefined ? row.subscription.enabled : row.subscription.id === id))
    await Promise.all(rows.map((row) => this.refreshOne(row)))
    return this.list()
  }

  /** The entries of all switched-on subscriptions between two days */
  entriesBetween(from: string, to: string): SubscribedEntryDto[] {
    const result: SubscribedEntryDto[] = []
    for (const row of this.repository.listAll()) {
      if (!row.subscription.enabled) continue
      // One that came in through sync and was never fetched here: fetch it in the background
      if (!row.attempted_at) void this.refreshOne(row)
      const feed = this.feedOf(row)
      if (!feed) continue
      for (const entry of entriesBetween(feed, from, to)) {
        result.push({
          ...entry,
          key: `${row.subscription.id}:${entry.key}`,
          subscriptionId: row.subscription.id,
          subscriptionName: row.subscription.name,
          color: row.subscription.color
        })
      }
    }
    return result
  }
}
