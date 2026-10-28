// I2: the compose editor's send guard. A component with hooks cannot be rendered in the node
// test env, so the decisions live in composeSend.ts and are tested here; the wiring in
// ComposeView is asserted from the source, as tests/mail_renderer_optimism.test.ts does.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createSendGate,
  draftSaveAllowed,
  findSessionSend,
  isUnclearSend,
  recipientKeyAction,
  unclearCheck
} from '@/components/mail/composeSend'
import type { OpSummary } from '../src/main/mailclient/core/types'

const KEY = '0f8fad5b-d9cb-469f-a165-70867728950e'

function op(overrides: Partial<OpSummary> = {}): OpSummary {
  return {
    id: 'op-1',
    kind: 'send',
    state: 'unknown',
    folderPath: null,
    targetFolderPath: null,
    uid: null,
    messageId: `${KEY}@example.test`,
    attempts: 1,
    createdAt: '2026-10-26T10:00:00Z',
    updatedAt: '2026-10-26T10:00:00Z',
    error: null,
    ...overrides
  }
}

describe('isUnclearSend (MR-03)', () => {
  it('recognises the core wording for a send the server may have', () => {
    // the text core/index.ts sendMail throws, as tRPC hands it to the renderer
    expect(isUnclearSend(new Error('Versand unklar, bitte im Ordner Gesendet prüfen: x'))).toBe(
      true
    )
  })

  it('keeps a definite failure a failure', () => {
    expect(isUnclearSend(new Error('Senden fehlgeschlagen: no server'))).toBe(false)
    expect(isUnclearSend(undefined)).toBe(false)
  })

  it('matches the message the core actually throws', () => {
    const core = readFileSync(join(process.cwd(), 'src/main/mailclient/core/draft_api.ts'), 'utf8')
    const thrown = core.match(/throw new Error\(`(Versand unklar[^:`]*)/)
    expect(thrown).not.toBeNull()
    expect(isUnclearSend(new Error(thrown![1]))).toBe(true)
  })
})

describe('draftSaveAllowed (MR-38)', () => {
  it('saves only while the editor is idle', () => {
    expect(draftSaveAllowed('idle')).toBe(true)
    expect(draftSaveAllowed('sending')).toBe(false)
    expect(draftSaveAllowed('unclear')).toBe(false)
  })
})

describe('createSendGate (MR-04)', () => {
  it('lets one sender in until it leaves', () => {
    const gate = createSendGate()
    expect(gate.enter()).toBe(true)
    expect(gate.busy).toBe(true)
    expect(gate.enter()).toBe(false)
    gate.leave()
    expect(gate.busy).toBe(false)
    expect(gate.enter()).toBe(true)
  })

  it('runs the send once for two calls in the same tick', async () => {
    const gate = createSendGate()
    let sends = 0
    const send = async () => {
      if (!gate.enter()) return
      try {
        await Promise.resolve()
        sends++
      } finally {
        gate.leave()
      }
    }
    await Promise.all([send(), send()])
    expect(sends).toBe(1)
    // and after it settled, the next one goes through
    await send()
    expect(sends).toBe(2)
  })
})

describe('findSessionSend / unclearCheck (MR-03)', () => {
  it('finds the send by the compose session key, whatever the domain', () => {
    const ops = [
      op({ id: 'other', messageId: 'aaaaaaaa-0000-4000-8000-000000000000@example.test' }),
      op({ id: 'mine' }),
      op({ id: 'flag', kind: 'flag', messageId: `${KEY}@example.test` })
    ]
    expect(findSessionSend(ops, KEY)?.id).toBe('mine')
  })

  it('accepts a Message-ID stored with angle brackets', () => {
    expect(findSessionSend([op({ messageId: `<${KEY}@example.test>` })], KEY)?.id).toBe('op-1')
  })

  it('takes the newest send of the session', () => {
    const ops = [
      op({ id: 'old', createdAt: '2026-10-26T10:00:00Z', state: 'cancelled' }),
      op({ id: 'new', createdAt: '2026-10-26T10:05:00Z' })
    ]
    expect(findSessionSend(ops, KEY)?.id).toBe('new')
  })

  it('probes an unresolved send, reports a settled one as sent, and leaves the rest', () => {
    expect(unclearCheck(op({ state: 'unknown' }))).toBe('probe')
    expect(unclearCheck(op({ state: 'conflict' }))).toBe('probe')
    expect(unclearCheck(op({ state: 'done' }))).toBe('sent')
    expect(unclearCheck(op({ state: 'cancelled' }))).toBe('unknown')
    expect(unclearCheck(undefined)).toBe('unknown')
  })
})

describe('recipientKeyAction (MR-04)', () => {
  const field = { text: '', hasSuggestions: false, hasRecipients: false }

  it('never lets an Enter fall through to the form', () => {
    expect(recipientKeyAction('Enter', field)).toBe('swallow')
    expect(recipientKeyAction('Enter', { ...field, text: '   ' })).toBe('swallow')
    expect(recipientKeyAction('Enter', { ...field, text: 'a@example.test' })).toBe('commit')
    expect(recipientKeyAction('Enter', { ...field, hasSuggestions: true })).toBe('pick')
  })

  it('keeps the other keys as they were', () => {
    expect(recipientKeyAction(',', { ...field, text: 'a@example.test' })).toBe('commit')
    expect(recipientKeyAction('Tab', { ...field, hasSuggestions: true })).toBe('pick')
    expect(recipientKeyAction('Tab', field)).toBeNull()
    expect(recipientKeyAction('ArrowDown', { ...field, hasSuggestions: true })).toBe('navigate')
    expect(recipientKeyAction('ArrowDown', field)).toBeNull()
    expect(recipientKeyAction('Backspace', { ...field, hasRecipients: true })).toBe('removeLast')
    expect(recipientKeyAction('Backspace', { ...field, text: 'a', hasRecipients: true })).toBeNull()
    expect(recipientKeyAction('a', field)).toBeNull()
  })
})

describe('ComposeView wiring (I2)', () => {
  const view = readFileSync(
    join(process.cwd(), 'src/renderer/src/components/mail/ComposeView.tsx'),
    'utf8'
  )
  const fnBody = (name: string) => {
    const start = view.indexOf(`const ${name} = `)
    expect(start).toBeGreaterThan(-1)
    const end = view.indexOf('\n  const ', start + 1)
    return view.slice(start, end === -1 ? undefined : end)
  }

  it('has no submit button and does not send from the form submit', () => {
    expect(view).not.toMatch(/type="submit"/)
    const submit = view.match(/onSubmit=\{([^}]*)\}/)
    expect(submit?.[1]).not.toContain('send')
  })

  it('takes the gate before the first await of a send', () => {
    const body = fnBody('send')
    const gateAt = body.indexOf('gate.enter()')
    expect(gateAt).toBeGreaterThan(-1)
    const awaitAt = body.indexOf('await ')
    expect(gateAt).toBeLessThan(awaitAt)
    expect(body).toContain('gate.leave()')
  })

  it('sends with the session key and locks on an unclear result', () => {
    const body = fnBody('sendGated')
    expect(body).toMatch(/sendKey: sendKey\.current/)
    expect(body).toMatch(/isUnclearSend\(error\)[\s\S]*setPhase\('unclear'\)/)
    expect(body).toContain("setPhase('sending')")
  })

  it('gives a deliberate resend a new key', () => {
    const body = fnBody('sendAsNew')
    expect(body.indexOf('sendKey.current = crypto.randomUUID()')).toBeLessThan(
      body.indexOf('await send()')
    )
  })

  it('stops draft saves outside the idle phase', () => {
    expect(fnBody('isDirty')).toContain('draftSaveAllowed(phaseRef.current)')
    expect(fnBody('save')).toContain('draftSaveAllowed(phaseRef.current)')
  })
})
