// Opens an invoice email in the user's mail program (see mailProgram.ts for
// the ways). The PDF and the .eml are kept in <userData>/E-Mail so the
// draft's attachment still exists when it is sent later; files older than
// 30 days are removed.
import { app, clipboard, shell } from 'electron'
import { execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { pathToFileURL } from 'url'
import type { MailProgramSetting } from '../api/schemas/settings.schema'
import { buildEml, mailtoUrl, type EmailDraft } from './eml'
import {
  addressSeparator,
  bccMailtoUrl,
  isProgramPath,
  mailMethodOf,
  thunderbirdComposeArg,
  type MailMethod
} from './mailProgram'

export type OpenEmailResult = {
  method: MailMethod
  /** The PDF that is attached (or to attach by hand) */
  pdfPath: string
  folder: string
}

const KEEP_DAYS = 30

function emailFolder(): string {
  return join(app.getPath('userData'), 'E-Mail')
}

async function removeOldFiles(folder: string): Promise<void> {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000
  for (const name of await readdir(folder)) {
    const path = join(folder, name)
    try {
      if ((await stat(path)).mtimeMs < cutoff) await rm(path, { force: true })
    } catch {
      // In use or gone: try again next time
    }
  }
}

/** The program Windows opens mailto: links with, '' when there is none */
async function mailtoHandlerPath(): Promise<string> {
  try {
    return (await app.getApplicationInfoForProtocol('mailto:')).path
  } catch {
    return ''
  }
}

/** Installed path of OUTLOOK.EXE / thunderbird.exe from Windows' "App Paths" */
function appPathOf(exe: string): Promise<string> {
  const keys = ['HKCU', 'HKLM'].map(
    (hive) => `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`
  )
  const query = (key: string) =>
    new Promise<string>((resolve) => {
      execFile('reg', ['query', key, '/ve'], { windowsHide: true }, (error, stdout) => {
        const match = /REG_(?:EXPAND_)?SZ\s+(.+)/.exec(stdout ?? '')
        const path = match?.[1].trim().replace(/^"|"$/g, '') ?? ''
        resolve(!error && path && existsSync(path) ? path : '')
      })
    })
  return keys.reduce<Promise<string>>(
    async (found, key) => (await found) || query(key),
    Promise.resolve('')
  )
}

/** Starts a program without waiting for it; false if it could not start */
function launch(path: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(path, args, { detached: true, stdio: 'ignore' })
    child.once('error', () => resolve(false))
    child.once('spawn', () => {
      child.unref()
      resolve(true)
    })
  })
}

export async function openEmail({
  draft,
  pdf,
  fileName,
  setting
}: {
  draft: EmailDraft
  pdf: Uint8Array
  fileName: string
  setting: MailProgramSetting
}): Promise<OpenEmailResult> {
  const folder = emailFolder()
  await mkdir(folder, { recursive: true })
  await removeOldFiles(folder)

  const pdfPath = join(folder, `${fileName}.pdf`)
  const emlPath = join(folder, `${fileName}.eml`)
  await writeFile(pdfPath, pdf)
  await writeFile(
    emlPath,
    buildEml(draft, { fileName: `${fileName}.pdf`, contentType: 'application/pdf', data: pdf })
  )

  // e2e tests: files only, no programs or Explorer windows
  if (process.env.BOOKINGIUM_NO_LAUNCH === '1') return { method: 'files', pdfPath, folder }

  const handler = await mailtoHandlerPath()
  let method: MailMethod = setting === 'auto' ? mailMethodOf(handler) : setting

  if (method === 'outlook' || method === 'thunderbird') {
    const exe = method === 'outlook' ? 'OUTLOOK.EXE' : 'thunderbird.exe'
    const programPath = isProgramPath(handler, method) ? handler : await appPathOf(exe)
    let started = false
    if (programPath && method === 'outlook') {
      started = await launch(programPath, ['/eml', emlPath])
    } else if (programPath) {
      const bodyPath = join(folder, `${fileName}.txt`)
      await writeFile(bodyPath, draft.body, 'utf-8')
      started = await launch(programPath, [
        '-compose',
        thunderbirdComposeArg(draft, bodyPath, pathToFileURL(pdfPath).href)
      ])
    }
    // Not installed after all: the way that works with any program
    if (!started) method = handler && mailMethodOf(handler) !== 'files' ? 'mailto' : 'files'
  }

  if (method === 'mailto') {
    await shell.openExternal(mailtoUrl(draft))
    shell.showItemInFolder(pdfPath)
  } else if (method === 'files') {
    shell.showItemInFolder(emlPath)
  }
  return { method, pdfPath, folder }
}

/** Opens the folder with the saved emails (toast action) */
export function showEmailFile(pdfPath: string): void {
  if (dirname(resolve(pdfPath)) === emailFolder()) shell.showItemInFolder(pdfPath)
}

/** The mail program's way of listing several addresses */
export async function mailAddressSeparator(setting: MailProgramSetting): Promise<string> {
  const method = setting === 'auto' ? mailMethodOf(await mailtoHandlerPath()) : setting
  return addressSeparator(method)
}

/**
 * Opens a new email with the addresses in BCC. When they don't fit in a
 * mailto: link, an empty email opens and the addresses go to the clipboard
 * for pasting into BCC; returns whether they are in the email.
 */
export async function openBccEmail(
  emails: string[],
  setting: MailProgramSetting
): Promise<boolean> {
  const handler = await mailtoHandlerPath()
  const method: MailMethod = setting === 'auto' ? mailMethodOf(handler) : setting
  const url = bccMailtoUrl(emails, method)
  if (!url) clipboard.writeText(emails.join(`${addressSeparator(method)} `))
  // e2e tests: no mail program
  if (process.env.BOOKINGIUM_NO_LAUNCH !== '1') await shell.openExternal(url ?? 'mailto:')
  return url !== null
}
