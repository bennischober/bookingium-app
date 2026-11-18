/** "1 Event" / "3 Events" */
export function eventCount(count: number): string {
  return `${count.toLocaleString('de-DE')} ${count === 1 ? 'Event' : 'Events'}`
}
