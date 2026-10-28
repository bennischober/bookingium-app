// S1 in the reading view: an action that reads a message's large parts waits for the one
// download of a message stored without them, and a failed download never runs the action
import { describe, expect, it } from 'vitest'
import { withWholeMessage } from '@/components/mail/completion'
import type { MessageDetail } from '../src/main/mailclient/core/types'

const detail = (complete: boolean, size: number): MessageDetail =>
  ({ id: 7, complete, attachments: [{ partId: '2', sizeBytes: size }] }) as MessageDetail

function harness(complete: () => Promise<MessageDetail>) {
  const log: string[] = []
  const adopted: MessageDetail[] = []
  const deps = {
    complete: () => {
      log.push('download')
      return complete()
    },
    busy: (on: boolean) => log.push(on ? 'busy' : 'idle'),
    adopt: (whole: MessageDetail) => {
      log.push('adopt')
      adopted.push(whole)
    }
  }
  return { log, adopted, deps }
}

describe('withWholeMessage', () => {
  it('runs the action at once on a complete message', async () => {
    const { log, deps } = harness(() => Promise.reject(new Error('not asked')))
    const message = detail(true, 100)
    const seen = await withWholeMessage(message, deps, (m) => m)
    expect(seen).toBe(message)
    expect(log).toEqual([])
  })

  it('downloads first, shows the wait, and hands the whole message on', async () => {
    const whole = detail(true, 5_100_000)
    const { log, adopted, deps } = harness(() => Promise.resolve(whole))
    const seen = await withWholeMessage(detail(false, 5_000_000), deps, (m) => {
      log.push('action')
      return m
    })
    expect(log).toEqual(['busy', 'download', 'idle', 'adopt', 'action'])
    expect(adopted).toEqual([whole])
    expect(seen.attachments[0].sizeBytes).toBe(5_100_000)
  })

  it('a failed download keeps its message, ends the wait and never runs the action', async () => {
    const offline = 'Offline – der Anhang ist noch nicht geladen'
    const { log, adopted, deps } = harness(() => Promise.reject(new Error(offline)))
    let ran = false
    await expect(
      withWholeMessage(detail(false, 5_000_000), deps, () => {
        ran = true
      })
    ).rejects.toThrow(offline)
    expect(ran).toBe(false)
    expect(adopted).toEqual([])
    expect(log).toEqual(['busy', 'download', 'idle'])
  })
})
