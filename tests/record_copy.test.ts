import { describe, expect, it } from 'vitest'
import {
  deleteQuestion,
  recordErrorToast,
  recordSuccessToast
} from '../src/renderer/src/lib/recordCopy'

// #170: one wording for create, update and delete feedback on every list and detail page
describe('recordCopy', () => {
  it('names the object and the record in the success toast', () => {
    expect(recordSuccessToast('create', 'Band', 'Musterband')).toEqual([
      'Band angelegt',
      { description: 'Musterband wurde angelegt.' }
    ])
    expect(recordSuccessToast('update', 'Festival', 'Musterfest')).toEqual([
      'Festival aktualisiert',
      { description: 'Musterfest wurde aktualisiert.' }
    ])
    expect(recordSuccessToast('delete', 'Firma', 'Muster GmbH')).toEqual([
      'Firma gelöscht',
      { description: 'Muster GmbH wurde gelöscht.' }
    ])
  })

  it('passes the error message through as the description', () => {
    expect(recordErrorToast('create', 'Hotel', 'Name fehlt')).toEqual([
      'Hotel konnte nicht angelegt werden',
      { description: 'Name fehlt' }
    ])
    expect(recordErrorToast('update', 'Person', 'x')[0]).toBe(
      'Person konnte nicht aktualisiert werden'
    )
    expect(recordErrorToast('delete', 'Bank', 'x')[0]).toBe('Bank konnte nicht gelöscht werden')
  })

  it('asks the delete question with German quotes', () => {
    expect(deleteQuestion('Musterband')).toBe('„Musterband“ löschen?')
  })
})
