import { t } from '../../../main/i18n/translate'
// #253: short tips where a feature sits. Which ones were read is kept per computer (localStorage):
// tips are about this app's use, not data, and the sync must not bring a read tip back.

export const TIPS = {
  dashboard: {
    title: t('Schneller ans Ziel'),
    text: t(
      'Alt+1 bis Alt+0 springen zu den wichtigsten Seiten, Strg+K sucht alles (Einträge, Seiten und Aktionen). Die Übersicht aller Tastenkürzel öffnet das Tastatur-Symbol oben rechts.'
    )
  },
  eventOverview: {
    title: t('Der Stand der Show auf einen Blick'),
    text: t(
      'Die Kacheln oben zeigen Gage, Vertrag, Rechnung, Advancing und Tickets. Ein Klick führt zum Bereich, wo man es ändert. „Bearbeiten“ schaltet alle Bereiche zugleich in den Bearbeitungsmodus, „Alles speichern“ sichert sie gemeinsam.'
    )
  },
  recordActions: {
    title: t('Erinnern und aufräumen'),
    text: t(
      '„Wiedervorlage“ legt eine Erinnerung zu diesem Eintrag an, sie erscheint am Tag auf dem Dashboard. Ist ein Eintrag doppelt angelegt, führt „…“ › „Zusammenführen“ beide zusammen, mit allen Events, Rechnungen und Dokumenten.'
    )
  },
  map: {
    title: t('Wo passt noch eine Show?'),
    text: t(
      '„Alle Kreise hervorheben“ füllt jeden Gebietsschutz halb durchsichtig. Wo sich Kreise überlappen, wird es dunkler; wo die Karte frei bleibt, blockiert keine Show. „Anfrage prüfen“ zeigt für einen Club und ein Datum, was eine Buchung blockieren würde.'
    )
  },
  marketing: {
    title: t('Atlas und Maßnahmen'),
    text: t(
      'Der Atlas ist die Recherche (Radios, Presse, Festivals …), er wird aus einer Datei eingespielt und über „Atlas aktualisieren…“ erneuert, ohne Status und Notizen zu verlieren. Maßnahmen sind, was gebucht ist (Radiospots, Plakate …), mit Kosten, Beleg und Rechnung.'
    )
  },
  invoices: {
    title: t('Rechnungen aus DATEV'),
    text: t(
      'Ist eine Rechnung schon in DATEV geschrieben, im Formular „Rechnung schon in DATEV erstellt“ wählen und die DATEV-Nummer eintragen. Bookingium zählt danach oberhalb weiter, so gibt es keine Nummer doppelt.'
    )
  },
  import: {
    title: t('Import ohne Dopplungen'),
    text: t(
      'Vorhandene Firmen und Personen werden am Namen bzw. an der E-Mail erkannt und nur ergänzt. Die Vorschau zeigt vorher, was neu angelegt und was ergänzt wird; „Vorhandene Angaben überschreiben“ ersetzt auch gefüllte Felder.'
    )
  }
} as const satisfies Record<string, { title: string; text: string }>

export type TipId = keyof typeof TIPS

export type TipState = {
  /** All tips off */
  off: boolean
  /** Tips clicked away */
  dismissed: string[]
  /** The version whose "Was ist neu" was shown last */
  lastSeenVersion: string | null
}

export const EMPTY_TIP_STATE: TipState = { off: false, dismissed: [], lastSeenVersion: null }

export function parseTipState(raw: string | null): TipState {
  try {
    const value = JSON.parse(raw ?? 'null') as Partial<TipState> | null
    if (!value || typeof value !== 'object') return EMPTY_TIP_STATE
    return {
      off: value.off === true,
      dismissed: Array.isArray(value.dismissed)
        ? value.dismissed.filter((id): id is string => typeof id === 'string')
        : [],
      lastSeenVersion: typeof value.lastSeenVersion === 'string' ? value.lastSeenVersion : null
    }
  } catch {
    return EMPTY_TIP_STATE
  }
}

export function isTipShown(state: TipState, id: TipId): boolean {
  return !state.off && !state.dismissed.includes(id)
}

export function dismissed(state: TipState, id: TipId): TipState {
  return state.dismissed.includes(id) ? state : { ...state, dismissed: [...state.dismissed, id] }
}

/** "Alle Tipps wieder anzeigen": every tip back, and tips on */
export function reset(state: TipState): TipState {
  return { ...state, off: false, dismissed: [] }
}

// ── the store: localStorage plus listeners, for useSyncExternalStore ──

const KEY = 'bookingium.tips'
const listeners = new Set<() => void>()
let cached: { raw: string | null; state: TipState } | null = null

function read(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function getTipState(): TipState {
  const raw = read()
  if (!cached || cached.raw !== raw) cached = { raw, state: parseTipState(raw) }
  return cached.state
}

export function setTipState(update: (state: TipState) => TipState): void {
  const next = update(getTipState())
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // storage not available: the change lasts until the window closes
    cached = { raw: JSON.stringify(next), state: next }
  }
  listeners.forEach((listener) => listener())
}

export function subscribeTips(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
