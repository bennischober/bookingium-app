// ========================================
// Booking archive: which folders are shows, and their date
// ========================================
// A band's booking archive is a tree of folders, one per show, often grouped by year:
//   Muster Band/2024/2024-06-21 I-Musterdorf Beispiel Festival/Vertrag/…
// A folder whose name starts with a date is a show ("2024-01-28-02-02 …" runs over several days).
// A folder with files of its own but no date in the name is a show too; its date comes from its
// files (a file name starting with a date, or the contract). No Electron (tests use it directly).
import { readdir, stat } from 'fs/promises'
import { join } from 'path'

export type ShowFolderRef = {
  path: string
  /** The folder's own name */
  name: string
  /** ISO date of the show, '' when neither the name nor a file name tells */
  date: string
  /** ISO date of the last day of a show over several days, '' for one day */
  endDate: string
  /** The name without the date ("I-Musterdorf Beispiel Festival") */
  title: string
}

const LEADING_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})-(\d{2})|[-_](\d{2})(?=[\s_-]|$))?(?:[\s_-]+(.*))?$/
const NAME_DATE =
  /(?:^|[^\d])(\d{4})-(\d{2})-(\d{2})(?!\d)|(?:^|[^\d])(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/

const valid = (year: number, month: number, day: number): boolean =>
  month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1990 && year <= 2100

const iso = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

/** "2024-06-21 I-Natz  Alpen Flair" → 2024-06-21, "I-Natz Alpen Flair" */
export function parseShowFolderName(name: string): Omit<ShowFolderRef, 'path' | 'name'> {
  const match = LEADING_DATE.exec(name.trim())
  if (!match) return { date: '', endDate: '', title: name.trim().replace(/\s+/g, ' ') }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!valid(year, month, day)) return { date: '', endDate: '', title: name.trim() }
  let endDate = ''
  if (match[4] && match[5]) {
    // "2024-01-28-02-02": to the 2nd of February, in the next year when it runs over New Year
    const endMonth = Number(match[4])
    const endDay = Number(match[5])
    const endYear = endMonth < month ? year + 1 : year
    if (valid(endYear, endMonth, endDay)) endDate = iso(endYear, endMonth, endDay)
  } else if (match[6]) {
    const endDay = Number(match[6])
    if (valid(year, month, endDay) && endDay > day) endDate = iso(year, month, endDay)
  }
  return {
    date: iso(year, month, day),
    endDate,
    title: (match[7] ?? '').trim().replace(/\s+/g, ' ')
  }
}

/** The first date in file names ("2023-07-29 Vertrag.pdf", "Konzertvertrag 29.07.2023.pdf") */
export function dateOfFileNames(names: readonly string[]): string {
  for (const name of names) {
    const match = NAME_DATE.exec(name)
    if (!match) continue
    const [year, month, day] = match[1]
      ? [Number(match[1]), Number(match[2]), Number(match[3])]
      : [Number(match[6]), Number(match[5]), Number(match[4])]
    if (valid(year, month, day)) return iso(year, month, day)
  }
  return ''
}

const hidden = (name: string) =>
  name.startsWith('.') || name.startsWith('~$') || name === 'desktop.ini' || name === '__MACOSX'

async function entries(folder: string): Promise<{ files: string[]; folders: string[] }> {
  const files: string[] = []
  const folders: string[] = []
  let names: string[] = []
  try {
    names = await readdir(folder)
  } catch {
    return { files, folders }
  }
  for (const name of names.sort((a, b) => a.localeCompare(b, 'de'))) {
    if (hidden(name)) continue
    try {
      const info = await stat(join(folder, name))
      if (info.isDirectory()) folders.push(name)
      else if (info.isFile()) files.push(name)
    } catch {
      // gone meanwhile
    }
  }
  return { files, folders }
}

/** The file names below a folder, a few levels deep, for the date fallback */
async function namesBelow(folder: string, depth: number): Promise<string[]> {
  const { files, folders } = await entries(folder)
  if (depth <= 0) return files
  const below = await Promise.all(folders.map((name) => namesBelow(join(folder, name), depth - 1)))
  return [...files, ...below.flat()]
}

/** The show folders below `root` (or `root` itself), newest first */
export async function findShowFolders(root: string, maxDepth = 3): Promise<ShowFolderRef[]> {
  const shows: ShowFolderRef[] = []
  const visit = async (folder: string, name: string, level: number): Promise<void> => {
    const parsed = parseShowFolderName(name)
    const { files, folders } = await entries(folder)
    if (parsed.date || (level > 0 && files.length > 0) || (level === 0 && folders.length === 0)) {
      const date = parsed.date || dateOfFileNames(await namesBelow(folder, 3))
      shows.push({ path: folder, name, ...parsed, date })
      return
    }
    if (level >= maxDepth) return
    for (const sub of folders) await visit(join(folder, sub), sub, level + 1)
  }
  await visit(root, root.split(/[\\/]/).filter(Boolean).pop() ?? root, 0)
  return shows.sort((a, b) => (b.date || '0').localeCompare(a.date || '0'))
}
