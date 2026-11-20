// Steps of a show that can be ticked as done outside the program ("extern erledigt")
import type { EventStep } from '../../../../main/api/schemas/event_step.schema'
import type { DocumentType } from '../../../../main/api/schemas/document.schema'
import { t } from '../../../../main/i18n/translate'

/** What the tick says: "<label> extern erledigt" */
export const EXTERNAL_STEP_LABELS: Record<EventStep, string> = {
  contract: t('Vertrag'),
  deposit: t('Vorkasse'),
  invoice: t('Rechnung'),
  hotel: t('Hotel'),
  advancing: t('Advancing'),
  tickets: t('Ticketmeldung')
}

/** The value of a status tile for a step ticked as done outside the program */
export const EXTERNAL_DONE_VALUE = 'extern erledigt'

/**
 * Steps whose outside paperwork can be attached right at the tick ("Datei hinzufügen"), and
 * the document type the file gets on the event's Dokumente tab
 */
export const EXTERNAL_STEP_DOCUMENT_TYPES: Partial<Record<EventStep, DocumentType>> = {
  contract: 'contract',
  deposit: 'deposit',
  invoice: 'invoice'
}

/** How many files of the event belong to a step (by its document type) */
export function stepFileCount(step: EventStep, documents: Array<{ documentType: string }>): number {
  const type = EXTERNAL_STEP_DOCUMENT_TYPES[step]
  return type ? documents.filter((document) => document.documentType === type).length : 0
}
