// #228: the agencies' settlement template as the import reads it, a made-up show with the
// numbers of a real one (4.221,50 € gage, 500 € advance on the gage)
// The template's rows as the import reads them (made-up show)
const row = (label: string, ...cells: string[]): string[] => [label, ...cells]
const at = (label: string, j: string): string[] => [label, '', '', '', '', '', '', '', '', j]
export const SETTLEMENT_RECORDS: string[][] = [
  [],
  ['KONZERTABRECHNUNG', '', '', '', '', 'Stand', '16.11.2026'],
  row('Künstler/Artist:', 'Beispielband', '', '', '', 'Veranstalter:', 'Beispiel Konzerte GmbH'),
  row('Datum:', '13.11.2026'),
  row('Stadt:', 'Musterstadt'),
  row('Venue:', 'Halle Probe'),
  row('Ticketsystem', 'System A', 'System B', '', '', '', 'Zusatzgebühr', 'Abendkasse'),
  row('Preiskategorie', 'Online', 'Regulär', '', '', '', '', 'Regulär'),
  row('Grundpreis', '30', '33', '', '', '', '3', '38'),
  row('Refundierung'),
  row('Verkäufe', '210', '58', '', '', '', '210', '5', '', '483'),
  row('Werbekostenzuschuss/Media', '1', '1', '0', '0', '0', '0', '0', '0'),
  ['', '', '', 'VS Deal:', '', 'ja', '', 'plus % ab Break:', '', 'nein'],
  at('Garantie lt. Vereinbarung', '2000'),
  row('Einnahmebeteiligung', '', '', '0,5', 'ab', '0', '', 'Nettoeinnahmen', '', '4221,495327103'),
  row('Einnahmebeteiligung 2', '', '', '0', 'ab', '0'),
  at('Summe Netto', '4221,495327103'),
  row('zzgl. MwSt.', '0,07'),
  at('Werbekostenzuschuss Netto', '250,46728972'),
  row('zzgl. MwSt.', '0,07'),
  at('Werbekostenzuschuss Brutto', '268'),
  at('Übernachtungspauschale', '700'),
  at('Technikpauschale', '0'),
  at('Nebenkosten Summe Netto', '700'),
  row('zzgl. MwSt.', '0,19'),
  at('Supportfee Netto', '0'),
  row('Rechnungspositionen'),
  at('Gage/Beteiligung an den Ticketeinnahmen', '4221,495327103'),
  at('abzgl. Abschlagszahlungen', '500'),
  at('Offener Gesamtbetrag Netto ohne Supportfee', '4671,96'),
  at('Offener Gesamtbetrag Brutto ohne Supportfee', '5083')
]
