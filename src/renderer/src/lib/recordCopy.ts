/**
 * #170: the one wording of create, update and delete feedback for a business object
 * (`useRecordMutations`). Documented in docs/UI_LANGUAGE.md; pure, so it is unit-tested.
 *
 *   Band angelegt                            Musterband wurde angelegt.
 *   Band konnte nicht angelegt werden        <the error's message>
 */

export type RecordAction = 'create' | 'update' | 'delete'

const DONE: Record<RecordAction, string> = {
  create: 'angelegt',
  update: 'aktualisiert',
  delete: 'gelöscht'
}

type ToastArgs = [title: string, data: { description: string }]

/** Title and description of the success toast; `name` is the record's label */
export function recordSuccessToast(action: RecordAction, noun: string, name: string): ToastArgs {
  return [`${noun} ${DONE[action]}`, { description: `${name} wurde ${DONE[action]}.` }]
}

/** Title and description of the error toast */
export function recordErrorToast(action: RecordAction, noun: string, message: string): ToastArgs {
  return [`${noun} konnte nicht ${DONE[action]} werden`, { description: message }]
}

/** The delete question: „<name>“ löschen? */
export function deleteQuestion(name: string): string {
  return `„${name}“ löschen?`
}
