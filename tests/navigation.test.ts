import { describe, expect, it } from 'vitest'
import { isAppDocument } from '../src/main/utils/navigation'

describe('isAppDocument', () => {
  const prod = 'file:///C:/app/out/renderer/index.html#/mail'
  const dev = 'http://localhost:5173/#/mail'

  it('allows the app page itself, with any route', () => {
    expect(isAppDocument('file:///C:/app/out/renderer/index.html#/invoices', prod)).toBe(true)
    expect(isAppDocument('http://localhost:5173/', dev)).toBe(true)
  })

  it('refuses a dropped file', () => {
    expect(isAppDocument('file:///C:/Users/x/Downloads/invoice.pdf', prod)).toBe(false)
  })

  it('refuses another site, and a port or query of its own', () => {
    expect(isAppDocument('https://example.test/', dev)).toBe(false)
    expect(isAppDocument('http://localhost:5174/', dev)).toBe(false)
    expect(isAppDocument('http://localhost:5173/?x=1', dev)).toBe(false)
  })

  it('refuses what is not a URL', () => {
    expect(isAppDocument('not a url', dev)).toBe(false)
  })
})
