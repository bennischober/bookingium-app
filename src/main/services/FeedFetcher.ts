import { singleton } from 'tsyringe'
import { feedFetchUrl, parseFeedAddress } from '../calendar/shareLink'

// #53: fetching calendar feeds (subscribed calendars, the check of the Bookingium file's
// public address). One instance, so tests swap `fetch` for a stub.

const TIMEOUT_MS = 20_000
// Large company calendars run to a few MB; beyond this it is not a calendar for this view
const MAX_BYTES = 15 * 1024 * 1024

@singleton()
export class FeedFetcher {
  fetch: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init)

  /** The text behind an http(s) or webcal address; throws a readable error */
  async text(address: string): Promise<string> {
    if (!parseFeedAddress(address)) {
      throw new Error('Keine gültige Adresse (https://… oder webcal://…).')
    }
    let response: Response
    try {
      response = await this.fetch(feedFetchUrl(address), {
        headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5' },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new Error('Der Server hat nicht rechtzeitig geantwortet.')
      }
      throw new Error(
        `Adresse nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (!response.ok) {
      throw new Error(
        response.status === 401 || response.status === 403
          ? `Kein Zugriff (HTTP ${response.status}) – ist die Adresse öffentlich bzw. der Link für alle freigegeben?`
          : `Der Server antwortet mit HTTP ${response.status}.`
      )
    }
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > MAX_BYTES) throw new Error('Der Kalender ist zu groß (über 15 MB).')
    const text = await response.text()
    if (text.length > MAX_BYTES) throw new Error('Der Kalender ist zu groß (über 15 MB).')
    return text
  }
}
