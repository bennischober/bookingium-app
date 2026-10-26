// B6: attachment names come from the sender, so they are hostile until sanitized.
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join, relative } from 'path'
import { describe, expect, it } from 'vitest'
import {
  ZONE_IDENTIFIER,
  isSafeToOpen,
  markFromInternet,
  safeAttachmentName,
  safePathIn,
  storedAttachmentName
} from '../src/main/mailclient/attachments'

describe('attachment file names (B6)', () => {
  it('keeps an ordinary name', () => {
    expect(safeAttachmentName('Rechnung 2026-01.pdf')).toBe('Rechnung 2026-01.pdf')
    expect(safeAttachmentName('foto.jpg')).toBe('foto.jpg')
  })

  it('strips path separators so the name cannot escape the folder', () => {
    // The contract is what matters: a flat name with no separator left
    for (const hostile of ['../../etc/passwd', 'C:\\Windows\\System32\\evil.exe', '/tmp/x.txt']) {
      const safe = safeAttachmentName(hostile)
      expect(safe).not.toMatch(/[\\/]/)
      expect(safe).not.toMatch(/^\.+$/)
      expect(safe.length).toBeGreaterThan(0)
    }
    // The last extension survives, so the OS still knows what it opens
    expect(safeAttachmentName('C:\\Windows\\System32\\evil.exe')).toMatch(/\.exe$/)
    // A name with no valid extension keeps all of its dots, just flattened
    expect(safeAttachmentName('../../etc/passwd')).not.toMatch(/[\\/]/)
  })

  it('strips characters Windows refuses', () => {
    expect(safeAttachmentName('a<b>c:d"e|f?g*h.txt')).toBe('a_b_c_d_e_f_g_h.txt')

    expect(safeAttachmentName('null\x00byte.txt')).toBe('null_byte.txt')
  })

  it('never returns a name that only consists of dots', () => {
    expect(safeAttachmentName('..')).not.toMatch(/^\.+$/)
    expect(safeAttachmentName('...')).toBe('_')
  })

  it('escapes Windows reserved device names, with and without an extension', () => {
    expect(safeAttachmentName('CON')).toBe('_CON')
    expect(safeAttachmentName('con.txt')).toBe('_con.txt')
    expect(safeAttachmentName('LPT1.log')).toBe('_LPT1.log')
    // Only the exact device name is reserved
    expect(safeAttachmentName('console.txt')).toBe('console.txt')
  })

  it('drops a trailing dot or space that Windows would swallow', () => {
    expect(safeAttachmentName('report.txt.')).toBe('report.txt')
    expect(safeAttachmentName('report ')).toBe('report')
  })

  it('caps the length but keeps the extension readable', () => {
    const long = `${'a'.repeat(300)}.pdf`
    const safe = safeAttachmentName(long)
    expect(safe.length).toBeLessThanOrEqual(120)
    expect(safe.endsWith('.pdf')).toBe(true)
  })

  it('falls back when nothing usable is left', () => {
    expect(safeAttachmentName('')).toBe('Anhang')
    expect(safeAttachmentName('   ')).toBe('Anhang')
    expect(safeAttachmentName('', 'Datei')).toBe('Datei')
  })

  // I11 (MR-23): an allowlist, because a list of dangerous types is never complete
  it('opens only allowlisted types', () => {
    for (const name of [
      'setup.exe',
      'run.BAT',
      'a.js',
      'link.url',
      'panel.cpl',
      'snap.msc',
      'x.wsf',
      'help.chm',
      'disk.iso',
      'disk.vhdx',
      'seite.html',
      'bild.svg',
      'x.settingcontent-ms',
      'ohne-endung'
    ]) {
      expect(isSafeToOpen(name), name).toBe(false)
    }
    for (const name of ['rechnung.pdf', 'text.txt', 'vertrag.DOCX', 'bild.png']) {
      expect(isSafeToOpen(name), name).toBe(true)
    }
  })

  it('strips bidi controls, so an RTLO name shows its real extension', () => {
    // "rechnung<RTLO>fdp.exe" reads as "rechnungexe.pdf"
    const safe = safeAttachmentName('rechnung\u202Efdp.exe')
    expect(safe).toBe('rechnungfdp.exe')
    expect(isSafeToOpen(safe)).toBe(false)
    expect(safeAttachmentName('\u200Bbild\u2066.png\uFEFF')).toBe('bild.png')
  })
})

describe('attachment paths and stored names (I11)', () => {
  it('keeps a hostile name inside the folder', () => {
    const folder = join(tmpdir(), 'bookingum-att-test')
    for (const hostile of ['../../etc/passwd', '..\\..\\x.pdf', '/abs/x.txt', '..', '']) {
      const target = safePathIn(folder, hostile)
      const rel = relative(folder, target)
      expect(rel, hostile).not.toMatch(/^\.\./)
      expect(rel.length, hostile).toBeGreaterThan(0)
      expect(dirname(target)).toBe(folder)
    }
    expect(safePathIn(folder, 'Rechnung.pdf')).toBe(join(folder, 'Rechnung.pdf'))
  })

  it('takes the name the mail stored, never one the caller sends', () => {
    const attachments = [
      { partId: '2', filename: 'vertrag.pdf' },
      { partId: '3', filename: null }
    ]
    expect(storedAttachmentName(attachments, '2')).toBe('vertrag.pdf')
    expect(storedAttachmentName(attachments, '3')).toBe('Anhang')
    expect(() => storedAttachmentName(attachments, '9')).toThrow('Anhang nicht gefunden')
  })

  it.runIf(process.platform === 'win32')('marks a written file as from the internet', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bookingum-motw-'))
    try {
      const file = join(dir, 'x.pdf')
      await writeFile(file, 'x')
      await markFromInternet(file)
      expect(await readFile(`${file}:Zone.Identifier`, 'utf-8')).toBe(ZONE_IDENTIFIER)
      expect(ZONE_IDENTIFIER).toContain('ZoneId=3')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
