// Renaming a document: the shown name, the kept extension, and the cleaning
// that keeps a typed name from becoming a path or a broken label.
import { describe, it, expect } from 'vitest'
import {
  DOCUMENT_DISPLAY_NAME_MAX,
  normalizeDisplayName
} from '../src/main/api/schemas/document.schema'
import { fileNameExtension, shownName } from '../src/renderer/src/components/documents/documentSort'

const doc = (fileName: string, displayName: string | null = null) => ({
  fileName,
  displayName
})

describe('the shown name', () => {
  it('is the file name until the user renames it', () => {
    expect(shownName(doc('scan_0042.pdf'))).toBe('scan_0042.pdf')
  })

  it('is the name the user gave it', () => {
    expect(shownName(doc('scan_0042.pdf', 'Rechnung März.pdf'))).toBe('Rechnung März.pdf')
  })

  it('falls back to the file name for an empty name', () => {
    // A name of only spaces is the same as no name, so the file name shows again
    expect(shownName(doc('scan_0042.pdf', '   '))).toBe('scan_0042.pdf')
    expect(shownName(doc('scan_0042.pdf', ''))).toBe('scan_0042.pdf')
  })
})

describe('the extension', () => {
  it('is kept from the file on disk', () => {
    expect(fileNameExtension('Rider.pdf')).toBe('.pdf')
    expect(fileNameExtension('Vertrag Berlin.docx')).toBe('.docx')
  })

  it('is empty for a name without one, and a leading dot is not an extension', () => {
    expect(fileNameExtension('Rider')).toBe('')
    expect(fileNameExtension('.gitkeep')).toBe('')
  })
})

describe('cleaning a typed name', () => {
  it('keeps a normal name as typed', () => {
    expect(normalizeDisplayName('Rechnung März')).toBe('Rechnung März')
  })

  it('trims it', () => {
    expect(normalizeDisplayName('  Rechnung  ')).toBe('Rechnung')
  })

  it('turns path separators into dashes, so a name never becomes a path', () => {
    expect(normalizeDisplayName('../../etc/passwd')).toBe('..-..-etc-passwd')
    expect(normalizeDisplayName('Ordner\\Datei')).toBe('Ordner-Datei')
  })

  it('drops control characters', () => {
    expect(normalizeDisplayName('Rech\u0000nung\u001f')).toBe('Rechnung')
  })

  it('is null when nothing is left, which clears the override', () => {
    expect(normalizeDisplayName('   ')).toBeNull()
    expect(normalizeDisplayName('')).toBeNull()
    expect(normalizeDisplayName(null)).toBeNull()
    expect(normalizeDisplayName(undefined)).toBeNull()
  })

  it('is capped so a long paste cannot break the table', () => {
    const long = 'a'.repeat(DOCUMENT_DISPLAY_NAME_MAX + 50)
    expect(normalizeDisplayName(long)).toHaveLength(DOCUMENT_DISPLAY_NAME_MAX)
  })
})
