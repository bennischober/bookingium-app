// #253: "Was ist neu" after an update: the highlights of a version, shown once per computer

/** Highlights per minor version ("1.6"); a patch release shows its minor's list */
export const WHATS_NEW: Record<string, string[]> = {
  '1.6': [
    'Übersichtlichere Seiten: Events haben nur noch vier Reiter (Übersicht, Ablauf, Geld, Dokumente). Oben auf der Übersicht steht der Stand der Show: Gage, Vertrag, Rechnung, Advancing und Tickets.',
    'Bands, Firmen, Personen, Clubs und Festivals zeigen ihre Angaben kompakt in einer Karte, dazu kurze Listen der nächsten Shows, offenen Rechnungen und Verknüpfungen. Leere Reiter verschwinden.',
    'Seltene Aktionen (Duplizieren, Zusammenführen, Löschen) liegen im „…“-Menü oben rechts.',
    'Das Menü ist neu geordnet: Planung, Finanzen, Kontakte, Kommunikation, Verwaltung. Alt+1 bis Alt+0 führen zu Dashboard, Kalender, Events, Touren, Rechnungen, Bands, Personen, Firmen, Clubs und E-Mail.',
    'Karte: „Alle Kreise hervorheben“ füllt jeden Gebietsschutz halb durchsichtig, Überlappungen werden dunkler.',
    'Tipps erklären an vielen Stellen, was eine Funktion macht. Weggeklickte Tipps holt Einstellungen › Allgemein zurück.'
  ]
}

/** "1.6.2" → "1.6" */
export function minorOf(version: string): string {
  return version.split('.').slice(0, 2).join('.')
}

/**
 * The highlights to show after starting `current`: those of its minor version, unless that
 * minor was shown already on this computer
 */
export function whatsNewFor(current: string, lastSeen: string | null): string[] {
  const minor = minorOf(current)
  if (lastSeen !== null && minorOf(lastSeen) === minor) return []
  return WHATS_NEW[minor] ?? []
}
