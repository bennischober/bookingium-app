// Record ids from detail route params (#/bands/abc must show "nicht gefunden")
import { describe, it, expect } from 'vitest'
import { parseRecordId } from '../src/renderer/src/lib/recordId'

describe('parseRecordId', () => {
  it('accepts positive integers', () => {
    expect(parseRecordId('1')).toBe(1)
    expect(parseRecordId('4711')).toBe(4711)
  })

  it('rejects everything else', () => {
    for (const param of [
      undefined,
      '',
      'abc',
      '0',
      '-3',
      '1.5',
      '1e3',
      ' 7',
      '0x10',
      '99999999999999999999'
    ]) {
      expect(parseRecordId(param)).toBeNull()
    }
  })
})
