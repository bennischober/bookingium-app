// #121 in the renderer: the follow-up a send leaves ("Wiedervorlage ohne Antwort"), the
// record the compose window gets in its query, and the labels of the list and history.
import { describe, expect, it } from 'vitest'
import {
  FOLLOW_UP_CHOICES,
  followUpForSend,
  parseRecordParam
} from '../src/renderer/src/components/mail/composeFollowUp'
import { parseComposeRequest } from '../src/renderer/src/components/mail/composeRequest'
import { awaitsReply, repliedLabel } from '../src/renderer/src/lib/followUps'
import { CreateFollowUpInput } from '../src/main/api/schemas/followUp.schema'

describe('followUpForSend', () => {
  const base = {
    subject: ' Angebot 2027 ',
    accountId: 'acc',
    messageId: 'key-1@example.test',
    today: '2026-11-06'
  }

  it('leaves none by default', () => {
    expect(FOLLOW_UP_CHOICES[0].value).toBe('none')
    expect(followUpForSend({ ...base, choice: 'none' })).toBeNull()
  })

  it('is due after the chosen days and names the sent mail and the record', () => {
    const followUp = followUpForSend({
      ...base,
      choice: '7',
      record: { type: 'invoice', id: 12 }
    })
    expect(followUp).toEqual({
      dueDate: '2026-11-13',
      note: 'Antwort auf „Angebot 2027“',
      record: { type: 'invoice', id: 12 },
      mail: { accountId: 'acc', messageId: 'key-1@example.test' }
    })
    // what main accepts
    expect(CreateFollowUpInput.safeParse(followUp).success).toBe(true)
  })

  it('has a note without a subject, and none without a Message-ID', () => {
    const followUp = followUpForSend({ ...base, subject: '  ', choice: '3' })
    expect(followUp).toMatchObject({ dueDate: '2026-11-09', note: expect.stringContaining('ohne') })
    expect(followUp).not.toHaveProperty('record')
    expect(followUpForSend({ ...base, messageId: '', choice: '14' })).toBeNull()
  })
})

describe('the record in the compose window’s query', () => {
  it('reads "type:id" and refuses anything else', () => {
    expect(parseRecordParam('invoice:12')).toEqual({ type: 'invoice', id: 12 })
    expect(parseRecordParam('event:3')).toEqual({ type: 'event', id: 3 })
    for (const bad of [undefined, null, '', 'invoice', 'invoice:x', 'mail:3', 'band:1.5']) {
      expect(parseRecordParam(bad)).toBeNull()
    }
  })

  it('travels with the compose request', () => {
    expect(parseComposeRequest({ mode: 'compose', token: 't', record: 'band:4' })).toMatchObject({
      record: { type: 'band', id: 4 }
    })
    expect(parseComposeRequest({ mode: 'compose', token: 't' })).toMatchObject({ record: null })
  })
})

describe('the labels (#121)', () => {
  it('flags an open mail follow-up due today or earlier with no reply', () => {
    const mail = { accountId: 'acc', messageId: 'm@example.test' }
    const today = '2026-11-06'
    expect(awaitsReply({ dueDate: '2026-11-06', mail, repliedAt: null }, today)).toBe(true)
    expect(awaitsReply({ dueDate: '2026-11-01', mail, repliedAt: null }, today)).toBe(true)
    expect(awaitsReply({ dueDate: '2026-11-07', mail, repliedAt: null }, today)).toBe(false)
    expect(awaitsReply({ dueDate: '2026-11-01', mail: null, repliedAt: null }, today)).toBe(false)
    expect(
      awaitsReply({ dueDate: '2026-11-01', mail, repliedAt: '2026-11-02 10:00:00' }, today)
    ).toBe(false)
  })

  it('says when the reply came, in local time', () => {
    expect(repliedLabel('2026-11-06 09:30:00')).toMatch(/^Antwort erhalten am \d\d\.\d\d\.2026$/)
    expect(repliedLabel('kaputt')).toBe('Antwort erhalten')
  })
})
