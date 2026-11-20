import { describe, expect, it, vi } from 'vitest'

// The hook module imports the toast (sonner); only the pure helpers are tested here
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), info: vi.fn() } }))

const { extensionOf, filterDropped } = await import('@/hooks/useFileDrop')

const byPath = (path: string) => path

describe('file drop rules', () => {
  it('reads the extension case-insensitively, from the name only', () => {
    expect(extensionOf('C:\\Shows\\Abrechnung.XLSX')).toBe('xlsx')
    expect(extensionOf('/tmp/v1.2/rider')).toBe('')
    expect(extensionOf('.hidden')).toBe('')
  })

  it('takes the allowed files and names the others', () => {
    const result = filterDropped(['a.xlsx', 'b.pdf', 'c.CSV'], byPath, ['xlsx', '.csv'], false)
    expect(result).toEqual({ accepted: ['a.xlsx', 'c.CSV'], rejected: ['b.pdf'], extra: 0 })
  })

  it('takes every file when no extensions are given', () => {
    expect(filterDropped(['a.xyz', 'b'], byPath, undefined).accepted).toEqual(['a.xyz', 'b'])
  })

  it('keeps the first allowed file for a single-file area and counts the rest', () => {
    const result = filterDropped(['x.pdf', 'a.xlsx', 'b.xlsx'], byPath, ['xlsx'], true)
    expect(result).toEqual({ accepted: ['a.xlsx'], rejected: ['x.pdf'], extra: 1 })
  })

  it('keeps two files of the same name from different folders', () => {
    const files = [
      { name: 'rider.pdf', dir: 'A' },
      { name: 'rider.pdf', dir: 'B' }
    ]
    expect(filterDropped(files, (file) => file.name, ['pdf']).accepted).toHaveLength(2)
  })
})
