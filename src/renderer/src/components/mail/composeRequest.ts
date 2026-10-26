/**
 * C1: the window opened as bookingum's own editor for an invoice mail. Main puts the
 * prepared draft into the query as base64 of its UTF-8 JSON, plus an opaque token and
 * the attachment's name - never a file path (I7, MR-21).
 */
export type ComposeRequest = {
  token: string
  /** The PDF main attaches on send, shown so the user knows it goes along */
  attachmentName: string
  to: string
  subject: string
  body: string
}

/**
 * I7 (MR-11): atob gives one character per byte, so an umlaut arrived as two Latin-1
 * characters ("Grüße" as "GrÃ¼ÃŸe"). The bytes are decoded as the UTF-8 they are.
 */
export function decodeDraftParam(value: string): string {
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

/**
 * The request in the window's query, or null when the window is not a compose window.
 * The router JSON-parses query values, so a name of digits would arrive as a number.
 */
export function parseComposeRequest(search: Record<string, unknown>): ComposeRequest | null {
  if (search.mode !== 'compose' || !search.token) return null
  try {
    const decoded = search.draft ? decodeDraftParam(String(search.draft)) : ''
    const draft = JSON.parse(decoded || '{}') as { to?: string; subject?: string; body?: string }
    return {
      token: String(search.token),
      attachmentName: search.attachment == null ? '' : String(search.attachment),
      to: draft.to ?? '',
      subject: draft.subject ?? '',
      body: draft.body ?? ''
    }
  } catch {
    return null
  }
}
