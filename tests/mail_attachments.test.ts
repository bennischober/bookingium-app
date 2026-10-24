// B6: attachment names come from the sender, so they are hostile until sanitized.
import { describe, expect, it } from 'vitest'
import { isExecutableName, safeAttachmentName } from '../src/main/mailclient/attachments'

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

  it('flags executables for the warning before opening', () => {
    for (const name of [
      'setup.exe',
      'run.BAT',
      'x.cmd',
      'a.js',
      'b.vbs',
      'c.ps1',
      'd.scr',
      'e.lnk',
      'f.msi'
    ]) {
      expect(isExecutableName(name), name).toBe(true)
    }
    for (const name of ['bild.png', 'rechnung.pdf', 'text.txt', 'ohne-endung']) {
      expect(isExecutableName(name), name).toBe(false)
    }
  })
})
