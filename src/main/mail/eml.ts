// An unsent email as an .eml file (MIME, RFC 5322/2045): plain-text body
// plus one attachment. "X-Unsent: 1" makes classic Outlook open it as a
// draft ready to send; without a From header it uses the default account.
//
// Pure (no Node or Electron APIs) so it can be unit tested.

export type EmailDraft = {
  /** Recipient address, '' when unknown (filled in by hand in the draft) */
  to: string
  subject: string
  /** Plain text, '\n' line breaks */
  body: string
}

export type EmailAttachment = {
  fileName: string
  contentType: string
  data: Uint8Array
}

const CRLF = '\r\n'

function isAscii(value: string): boolean {
  return /^[\x20-\x7e]*$/.test(value)
}

/** Base64 of UTF-8 text or bytes, in lines of 76 characters */
function base64Lines(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return (btoa(binary).match(/.{1,76}/g) ?? []).join(CRLF)
}

/**
 * A header value, as RFC 2047 encoded words when it is not plain ASCII.
 * Each word stays under 75 characters and holds whole characters only;
 * `separator` folds the line between words (a space inside quoted values).
 */
export function encodeHeader(value: string, separator = `${CRLF} `): string {
  if (isAscii(value)) return value
  const words: string[] = []
  let chunk = ''
  for (const char of value) {
    // 45 UTF-8 bytes -> 60 base64 characters, plus 12 for =?UTF-8?B?…?=
    if (new TextEncoder().encode(chunk + char).length > 45) {
      words.push(chunk)
      chunk = ''
    }
    chunk += char
  }
  if (chunk) words.push(chunk)
  return words.map((word) => `=?UTF-8?B?${base64Lines(word)}?=`).join(separator)
}

/** Content-Disposition with the file name (RFC 2231 when not plain ASCII) */
function dispositionOf(fileName: string): string {
  if (isAscii(fileName) && !fileName.includes('"')) {
    return `attachment; filename="${fileName}"`
  }
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  )
  return `attachment; filename*=UTF-8''${encoded}`
}

/** The draft as an .eml file (CRLF line endings) */
export function buildEml(
  draft: EmailDraft,
  attachment: EmailAttachment,
  boundary = `----=_Bookingium_${Date.now().toString(36)}`
): string {
  const headers = [
    'X-Unsent: 1',
    ...(draft.to ? [`To: ${draft.to}`] : []),
    `Subject: ${encodeHeader(draft.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`
  ]
  const text = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(draft.body.replace(/\r?\n/g, CRLF))
  ]
  // Outlook reads the name from Content-Type, other programs from
  // Content-Disposition: both carry it
  const file = [
    `--${boundary}`,
    `Content-Type: ${attachment.contentType}; name="${encodeHeader(attachment.fileName, ' ')}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: ${dispositionOf(attachment.fileName)}`,
    '',
    base64Lines(attachment.data)
  ]
  return [...headers, '', ...text, ...file, `--${boundary}--`, ''].join(CRLF)
}

/** mailto: link with recipient, subject and text (no attachment possible) */
export function mailtoUrl(draft: EmailDraft): string {
  const query = [
    `subject=${encodeURIComponent(draft.subject)}`,
    `body=${encodeURIComponent(draft.body.replace(/\r?\n/g, '\r\n'))}`
  ].join('&')
  return `mailto:${encodeURIComponent(draft.to).replace(/%40/g, '@')}?${query}`
}
