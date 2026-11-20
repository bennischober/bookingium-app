// #254: English UI texts of map, keyed by the German source string (see ../translate.ts)

export const mapEn: Record<string, string> = {
  '<a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a>':
    '<a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a>',
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> · PLZ-Daten: <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a>, CC BY 4.0':
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> · Postcode data: <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a>, CC BY 4.0',
  'Anfrage: {{name}}': 'Request: {{name}}',
  'Agenturbuchung ({{agency}})': 'Agency booking ({{agency}})',
  '{{km}} km, {{germanDate}} – {{germanDate2}}': '{{km}} km, {{germanDate}} – {{germanDate2}}',
  'gegenseitig im Gebietsschutz': 'mutually within the radius clause',
  'liegt im Gebietsschutz der Anfrage': "is within the request's radius clause",
  'Anfrage liegt in seinem Gebietsschutz': 'request is within its radius clause',
  'Ort unbekannt, Zeitraum überschneidet sich – bitte prüfen':
    'Place unknown, period overlaps – please check',
  'kein Club/Festival': 'no club/festival',
  'keine Adresse': 'no address',
  'PLZ unbekannt': 'postcode unknown',
  'Datum ungültig': 'date invalid',
  '<br>Frei für die Band': '<br>Free for the band',
  'Blockiert durch': 'Blocked by',
  'Risiko (ausstehend)': 'Risk (pending)',
  '+ {{more}} weitere': '+ {{more}} more',
  '1 Woche': '1 week',
  '{{n}} Wochen': '{{n}} weeks',
  '{{km}} km · {{weeks}} vorher, {{weeksAfter}} nachher':
    '{{km}} km · {{weeks}} before, {{weeksAfter}} after',
  'ganze Zahl von {{min}} bis {{max}}': 'whole number from {{min}} to {{max}}',
  'Radius: {{km}}': 'Radius: {{km}}',
  'Wochen vorher: {{before}}': 'Weeks before: {{before}}',
  'Wochen nachher: {{after}}': 'Weeks after: {{after}}',
  'Alle drei Felder ausfüllen': 'Fill in all three fields',
  'Radius (km)': 'Radius (km)',
  'Wochen vorher': 'Weeks before',
  'Wochen nachher': 'Weeks after',
  'Leere Felder übernehmen': 'Empty fields take over',
  'den Standard': 'the default',
  Überschneidungen: 'Overlaps',
  'nicht auf der Karte': 'not on the map'
}
