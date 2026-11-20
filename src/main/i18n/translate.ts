// #254: the UI language. German is the source and the default: a UI string is written as German
// text and passed through t(), which looks it up in the dictionary of the chosen language and
// falls back to the German text. So every string on screen can still be found by searching for
// its German wording, and a missing translation shows German instead of a key.
//
// The language is chosen once per window load: the renderer sets it before any page module is
// evaluated (src/renderer/src/i18nSetup.ts), and switching it reloads the window. That is why
// module-level label maps may call t() directly.
//
// Pure module: main imports it directly, the renderer by relative path like the schemas.
// tests/i18n_guard.test.ts checks that every t('…') literal has an English entry.

import { EN } from './en'

export type Language = 'de' | 'en'

export const LANGUAGES: readonly Language[] = ['de', 'en']

/** Names of the languages in their own language, for the picker */
export const LANGUAGE_NAMES: Record<Language, string> = { de: 'Deutsch', en: 'English' }

/** BCP 47 locale for dates and numbers. English uses British formats (day before month, 24 h) */
const LOCALES: Record<Language, string> = { de: 'de-DE', en: 'en-GB' }

const DICTIONARIES: Record<Language, Readonly<Record<string, string>>> = { de: {}, en: EN }

let current: Language = 'de'

export function isLanguage(value: unknown): value is Language {
  return value === 'de' || value === 'en'
}

export function setLanguage(language: Language): void {
  current = language
}

export function getLanguage(): Language {
  return current
}

/** Locale for Intl and toLocale*String in the UI. Documents for third parties keep their own. */
export function uiLocale(): string {
  return LOCALES[current]
}

export type TranslateVars = Readonly<Record<string, unknown>>

/**
 * The UI text for a German source string in the current language. `{{name}}` placeholders are
 * filled from `vars` after the lookup, so the key stays the same for every value. Values are
 * inserted like a template literal would (String(value)); a number that needs grouping is
 * formatted by the caller with uiLocale(), so a year or an id never gets a separator.
 */
export function t(german: string, vars?: TranslateVars): string {
  const text = DICTIONARIES[current][german] ?? german
  return vars ? interpolate(text, vars) : text
}

function interpolate(text: string, vars: TranslateVars): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  )
}

/** Placeholders of a source string or its translation, for the guard test */
export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort()
}
