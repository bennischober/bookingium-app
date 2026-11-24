// ========================================
// #53: subscription addresses
// ========================================
// Pure: no Electron, no Node. Calendar apps fetch a subscription from their own servers
// (Google, Outlook.com) or the device (Apple, Outlook classic), so the Bookingium file needs a
// public address. The usual way is to keep it in a OneDrive or Dropbox folder and share it;
// the share link opens a web page, though, not the file. These helpers turn such a link into
// the file's direct download address.

export type ShareProvider = 'onedrive' | 'sharepoint' | 'dropbox' | 'googledrive' | 'other'

/** webcal:// and webcals:// (the "open in calendar app" scheme) are plain https */
export function feedFetchUrl(address: string): string {
  return address.trim().replace(/^webcals?:\/\//i, 'https://')
}

/** A usable http(s) or webcal address, or null */
export function parseFeedAddress(address: string): URL | null {
  try {
    const url = new URL(feedFetchUrl(address))
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

function base64Url(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')
}

/**
 * The direct download address of a shared file. Unknown hosts come back unchanged (a link
 * that already is a direct address, a web server of the user's own).
 */
export function directDownloadUrl(link: string): { url: string; provider: ShareProvider } | null {
  const url = parseFeedAddress(link)
  if (!url) return null
  const host = url.hostname.toLowerCase()

  // OneDrive personal: 1drv.ms/... or onedrive.live.com/... share links. The shares API serves
  // the file of an "anyone with the link" share without signing in.
  if (host === '1drv.ms' || host === 'onedrive.live.com' || host === 'api.onedrive.com') {
    if (host === 'api.onedrive.com') return { url: url.toString(), provider: 'onedrive' }
    return {
      url: `https://api.onedrive.com/v1.0/shares/u!${base64Url(url.toString())}/root/content`,
      provider: 'onedrive'
    }
  }

  // OneDrive for work or school / SharePoint: download=1 on the share link
  if (host.endsWith('.sharepoint.com')) {
    url.searchParams.set('download', '1')
    return { url: url.toString(), provider: 'sharepoint' }
  }

  // Dropbox: dl=1 instead of dl=0 (rlkey and st stay, newer links need them)
  if (host === 'www.dropbox.com' || host === 'dropbox.com') {
    url.searchParams.delete('raw')
    url.searchParams.set('dl', '1')
    return { url: url.toString(), provider: 'dropbox' }
  }

  // Google Drive: drive.google.com/file/d/<id>/view → uc?export=download&id=<id>
  if (host === 'drive.google.com') {
    const id = url.pathname.match(/\/file\/d\/([^/]+)/)?.[1] ?? url.searchParams.get('id')
    if (id) {
      return {
        url: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`,
        provider: 'googledrive'
      }
    }
    return { url: url.toString(), provider: 'googledrive' }
  }

  return { url: url.toString(), provider: 'other' }
}

/** What a fetched file says about the Bookingium calendar in it */
export interface FeedFileInfo {
  isBookingium: boolean
  events: number
  // When it was written (DTSTAMP of its entries, all the same), ISO; null without entries
  writtenAt: string | null
}

/** Reads PRODID, the VEVENT count and the write time of a Bookingium .ics */
export function inspectFeedFile(text: string): FeedFileInfo {
  const unfolded = text.replace(/\r?\n[ \t]/g, '')
  const isBookingium = /^PRODID:-\/\/Bookingium\/\//m.test(unfolded)
  const events = (unfolded.match(/^BEGIN:VEVENT\s*$/gm) ?? []).length
  const stamp = unfolded.match(/^DTSTAMP:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/m)
  const writtenAt = stamp
    ? new Date(
        Date.UTC(+stamp[1], +stamp[2] - 1, +stamp[3], +stamp[4], +stamp[5], +stamp[6])
      ).toISOString()
    : null
  return { isBookingium, events, writtenAt }
}
