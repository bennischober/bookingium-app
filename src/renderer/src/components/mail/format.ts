import type { FolderNode } from '../../../../main/mailclient/core/types'

export const messageKey = (accountId: string, id: number) => ['mail', accountId, 'message', id]

// Display names for the standard folders (IMAP SPECIAL-USE); other folders
// keep the name they have on the server
const SPECIAL_FOLDER_NAMES: Array<[string, string]> = [
  ['Inbox', 'Posteingang'],
  ['Drafts', 'Entwürfe'],
  ['Sent', 'Gesendet'],
  ['Archive', 'Archiv'],
  ['Junk', 'Spam'],
  ['Trash', 'Papierkorb']
]

export function folderLabel(folder: FolderNode): string {
  if (folder.path.toUpperCase() === 'INBOX') return 'Posteingang'
  const special = SPECIAL_FOLDER_NAMES.find(([use]) => folder.specialUse?.includes(use))
  return special ? special[1] : folder.name
}

export function isInbox(folder: FolderNode): boolean {
  return folder.path.toUpperCase() === 'INBOX' || Boolean(folder.specialUse?.includes('Inbox'))
}

export function isTrash(folder: FolderNode | undefined): boolean {
  return Boolean(folder?.specialUse?.includes('Trash'))
}

export function flattenFolders(folders: FolderNode[]): FolderNode[] {
  return folders.flatMap((f) => [f, ...flattenFolders(f.children)])
}

/** Time for today's mails, otherwise the date */
export function formatListDate(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: date.getFullYear() === now.getFullYear() ? undefined : '2-digit'
  })
}

export function formatFullDate(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'full', timeStyle: 'short' })
    : 'Unbekannt'
}

export function formatSize(bytes: number): string {
  if (bytes >= 1e6)
    return `${(bytes / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`
  return `${bytes} B`
}

export function formatAddresses(list: { name: string; email: string }[]): string {
  return list.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(', ')
}

/** No path separators or control characters in a file name from a mail */
export function safeFileName(name: string, fallback: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim()
  return (cleaned || fallback).slice(0, 120)
}

/**
 * Search snippets mark hits as [hit] (SQLite FTS5 snippet()). Split them
 * into parts for rendering as text: mail content never becomes HTML here.
 */
export function snippetParts(snippet: string): Array<{ text: string; hit: boolean }> {
  const parts: Array<{ text: string; hit: boolean }> = []
  const re = /\[([^[\]]*)\]/g
  let last = 0
  for (let m = re.exec(snippet); m; m = re.exec(snippet)) {
    if (m.index > last) parts.push({ text: snippet.slice(last, m.index), hit: false })
    parts.push({ text: m[1], hit: true })
    last = m.index + m[0].length
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), hit: false })
  return parts
}

/** Saves bytes through the browser's download (Electron asks where) */
export function saveBytes(bytes: Uint8Array, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
