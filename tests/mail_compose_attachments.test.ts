// B7: the attachment size limit is checked before a file is read into memory.
import { describe, expect, it } from 'vitest'
import {
  attachmentsFit,
  base64Bytes,
  MAX_ATTACHMENT_BYTES
} from '../src/renderer/src/components/mail/composeDraft'

const MB = 1024 * 1024

/** An attachment whose base64 string encodes `bytes` bytes */
const existing = (bytes: number) => ({ base64: 'A'.repeat(Math.ceil((bytes * 4) / 3)) })

describe('attachment size limit (B7)', () => {
  it('allows a mail well under the limit', () => {
    expect(attachmentsFit([], [{ size: 1 * MB }])).toBe(true)
  })

  it('allows exactly the limit, not one byte more', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(20 * MB)
    expect(attachmentsFit([], [{ size: MAX_ATTACHMENT_BYTES }])).toBe(true)
    expect(attachmentsFit([], [{ size: MAX_ATTACHMENT_BYTES + 1 }])).toBe(false)
  })

  it('counts what is already attached', () => {
    const used = 15 * MB
    expect(attachmentsFit([existing(used)], [{ size: 4 * MB }])).toBe(true)
    expect(attachmentsFit([existing(used)], [{ size: 6 * MB }])).toBe(false)
  })

  it('adds up several new files in one go', () => {
    // Four 6 MB files are 24 MB together, even though each one fits alone
    const files = Array.from({ length: 4 }, () => ({ size: 6 * MB }))
    expect(attachmentsFit([], files)).toBe(false)
    expect(attachmentsFit([], files.slice(0, 3))).toBe(true)
  })

  it('reads the size of a base64 string without decoding it', () => {
    // 4 base64 characters are 3 bytes
    expect(base64Bytes('AAAA')).toBe(3)
    expect(base64Bytes('')).toBe(0)
    // Padding counts in, which only makes the estimate more conservative
    expect(base64Bytes('AAA=')).toBe(3)
  })

  it('accepts an empty selection', () => {
    expect(attachmentsFit([], [])).toBe(true)
  })
})
