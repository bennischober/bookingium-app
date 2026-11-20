import { afterEach, describe, expect, it } from 'vitest'
import { setLanguage, t, uiLocale } from '../src/main/i18n/translate'
import { TERMS } from '../src/main/api/terms'

// #254: German source strings, English lookup, German fallback

afterEach(() => setLanguage('de'))

describe('t', () => {
  it('returns the German text by default', () => {
    expect(t('Kalender')).toBe('Kalender')
    expect(uiLocale()).toBe('de-DE')
  })

  it('looks the text up in English', () => {
    setLanguage('en')
    expect(t('Kalender')).toBe('Calendar')
    expect(uiLocale()).toBe('en-GB')
  })

  it('falls back to German for a text without translation', () => {
    setLanguage('en')
    expect(t('Noch nicht übersetzt')).toBe('Noch nicht übersetzt')
  })

  it('fills placeholders after the lookup, like a template literal', () => {
    expect(t('{{count}} Wiedervorlagen fällig', { count: 2026 })).toBe('2026 Wiedervorlagen fällig')
    setLanguage('en')
    expect(t('{{count}} Wiedervorlagen fällig', { count: '1,200' })).toBe('1,200 follow-ups due')
  })
})

describe('TERMS', () => {
  it('gives the nouns of the current language', () => {
    expect(TERMS.company.plural).toBe('Firmen')
    expect(TERMS.company.Neuen).toBe('Neue Firma')
    setLanguage('en')
    expect(TERMS.company.plural).toBe('Companies')
    expect(TERMS.event.einen).toBe('an event')
    expect(TERMS.company.Neuen).toBe('new company')
  })
})
