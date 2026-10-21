// Which way an invoice email opens, by the mail program in use.
//
// No mail program opens an attachment from a mailto: link, so each one gets
// what it can do best:
//   outlook     classic Outlook opens the .eml as a draft (OUTLOOK.EXE /eml)
//   thunderbird Thunderbird composes a new email with the PDF (-compose)
//   mailto      everything else (new Outlook, …): recipient, subject and text
//               via mailto:, the PDF selected in Explorer to drag in
//   files       no mail program: email and PDF are saved, their folder opens
//
// "Automatisch" goes by the program Windows opens mailto: links with; when
// none is set up, by an installed classic Outlook or Thunderbird
// (openEmail.ts looks them up), and only without both by 'files'.
//
// Pure (no Node or Electron APIs) so it can be unit tested.
import type { MailProgramSetting } from '../api/schemas/settings.schema'
import type { EmailDraft } from './eml'

export type MailMethod = Exclude<MailProgramSetting, 'auto'>

/** Executable file name of a program path ("C:\…\OUTLOOK.EXE" -> "outlook.exe") */
function exeName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? '').toLowerCase()
}

/**
 * The method for the program Windows opens mailto: links with (its path;
 * '' when there is none). Windows' "choose an app" dialog (OpenWith.exe)
 * means no mail program is set up.
 */
export function mailMethodOf(handlerPath: string): MailMethod {
  const exe = exeName(handlerPath)
  if (exe === 'outlook.exe') return 'outlook'
  if (exe === 'thunderbird.exe') return 'thunderbird'
  if (!exe || exe === 'openwith.exe') return 'files'
  return 'mailto'
}

/** Programs "Automatisch" looks for when Windows has no mailto: program, in this order */
export const INSTALLED_MAIL_PROGRAMS = ['outlook', 'thunderbird'] as const

/** Executable file names, as Windows' "App Paths" lists them */
export const PROGRAM_EXE: Record<(typeof INSTALLED_MAIL_PROGRAMS)[number], string> = {
  outlook: 'OUTLOOK.EXE',
  thunderbird: 'thunderbird.exe'
}

/** Arguments that open a mailto: link, the way Windows starts the program for one */
export function mailtoProgramArgs(method: 'outlook' | 'thunderbird', url: string): string[] {
  return method === 'outlook' ? ['/c', 'ipm.note', '/m', url] : ['-osint', '-compose', url]
}

/** Whether `path` is the executable of the given program */
export function isProgramPath(path: string, method: 'outlook' | 'thunderbird'): boolean {
  return exeName(path) === `${method}.exe`
}

/**
 * Thunderbird's -compose argument. Values are quoted with ' and can't
 * contain one; the text comes from a file (keeps line breaks and umlauts).
 */
export function thunderbirdComposeArg(
  draft: EmailDraft,
  bodyFilePath: string,
  attachmentUrl: string
): string {
  const quote = (value: string) => `'${value.replace(/'/g, '’')}'`
  return [
    ...(draft.to ? [`to=${quote(draft.to)}`] : []),
    `subject=${quote(draft.subject)}`,
    `message=${quote(bodyFilePath)}`,
    `attachment=${quote(attachmentUrl)}`
  ].join(',')
}

// Longest mailto: link sent to the mail program; Windows and some programs
// cut longer ones off
export const MAX_MAILTO_LENGTH = 2000

/** Classic Outlook splits addresses at ';' only, the others at ',' */
export function addressSeparator(method: MailMethod): string {
  return method === 'outlook' ? ';' : ','
}

/**
 * A new email with the addresses in BCC (mailing lists). Null when the link
 * would be too long; the caller then copies the addresses for pasting instead.
 */
export function bccMailtoUrl(emails: string[], method: MailMethod): string | null {
  const bcc = emails
    .map((email) => encodeURIComponent(email).replace(/%40/g, '@'))
    .join(addressSeparator(method))
  const url = `mailto:?bcc=${bcc}`
  return url.length <= MAX_MAILTO_LENGTH ? url : null
}
