// #235: advancing and tickets where the information arrives - the mail. The advancing mail of a
// show, the shows a promoter's mail belongs to with what it suggests, the sender as contact on
// site (and with the club), and the open points: advancing not done, sales reports grown old.
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { container } from 'tsyringe'
import { and, eq } from 'drizzle-orm'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { advancingDraft, soldInText, suggestedStage } from '../src/main/advancing/advancingMail'
import { AdvancingService } from '../src/main/services/AdvancingService'
import { OpenItemsService } from '../src/main/services/OpenItemsService'
import { createInvoiceComposeRegistry, sendInvoiceMail } from '../src/main/mail/invoiceSend'
import type { DraftInput } from '../src/main/mailclient/core/types'
import { openItemTab, openItemText } from '../src/renderer/src/components/open-items/openItemText'
import { setupTestDb } from './helpers/setup'

setupTestDb()

const TODAY = '2026-11-19'

describe('advancing mail text', () => {
  it('writes to the promoter contact with the contact on site in cc', () => {
    const draft = advancingDraft(
      {
        date: '2026-11-13',
        bandName: 'Beispielband',
        venueName: 'Halle Probe',
        city: 'Münster',
        performanceTime: '20:30'
      },
      {
        promoterPerson: { firstName: 'Maik', lastName: 'Probe', email: 'maik@example.com' },
        promoterCompany: { name: 'Probe Konzerte', email: 'info@example.com' },
        local: { firstName: 'Jo', lastName: 'Vorort', email: 'jo@example.org' }
      }
    )
    expect(draft.to).toBe('Maik Probe <maik@example.com>')
    expect(draft.cc).toBe('Jo Vorort <jo@example.org>')
    expect(draft.subject).toBe('Advancing Beispielband – Fr., 13.11.2026, Halle Probe, Münster')
    expect(draft.body).toMatch(/^Hallo Maik,/)
    expect(draft.body).toContain('bei uns notiert: 20:30')
  })

  it('falls back to the promoter company and has no cc without a contact on site', () => {
    const draft = advancingDraft(
      { date: '2026-11-14', bandName: 'B', venueName: '', city: '', performanceTime: null },
      {
        promoterPerson: undefined,
        promoterCompany: { name: 'Probe Konzerte', email: 'info@example.com' },
        local: undefined
      }
    )
    expect(draft).toMatchObject({ to: 'Probe Konzerte <info@example.com>', cc: '' })
    expect(draft.body).toMatch(/^Hallo,/)
  })

  it('finds a ticket count in a mail and suggests the next stage', () => {
    expect(soldInText('Hi, aktuell 143 Tickets verkauft!')).toBe(143)
    expect(soldInText('VVK-Stand: 1.212')).toBe(1212)
    expect(soldInText('Wir sind bei 87 Karten')).toBe(87)
    expect(soldInText('Load-in um 16 Uhr')).toBeNull()
    expect(suggestedStage('contacted')).toBe('in_progress')
    expect(suggestedStage('done')).toBeNull()
  })

  it('sends an advancing mail without an attachment and reports it to its window', async () => {
    const registry = createInvoiceComposeRegistry(() => 'token-1')
    const token = registry.register({ advancingEventId: 7, accountId: 'acc' })
    const send = vi.fn(async (sent: DraftInput) => ({
      messageId: `<${sent.sendKey}@example.test>`
    }))
    const readPdf = vi.fn()
    await sendInvoiceMail(
      {
        registry,
        ledger: {
          queueInvoiceEmail: vi.fn(),
          dropQueuedInvoiceEmail: vi.fn(),
          hasQueuedInvoiceEmails: vi.fn(() => false),
          confirmInvoiceEmail: vi.fn(() => null)
        },
        readPdf,
        send
      },
      {
        token,
        accountId: 'acc',
        draftUid: null,
        mail: {
          to: [],
          subject: 'Advancing',
          bodyText: 'x',
          sendKey: 'k1'
        } as unknown as DraftInput
      }
    )
    expect(readPdf).not.toHaveBeenCalled()
    expect(send.mock.calls[0][0].attachments).toBeUndefined()
    expect(registry.release(token)).toEqual({ sent: true, messageId: 'k1@example.test' })
  })
})

let counter = 0
/** A confirmed show with a band, a club and a promoter whose contact has this e-mail */
function show(date: string, promoterEmail: string) {
  counter += 1
  const owner = db
    .insert(schema.company)
    .values({ name: `Mail Firma ${counter}` })
    .returning()
    .get()
  const band = db
    .insert(schema.band)
    .values({ name: `Mail Band ${counter}`, company_id: owner.id })
    .returning()
    .get()
  const address = db.insert(schema.address).values({ city: 'Münster' }).returning().get()
  const venue = db
    .insert(schema.venue)
    .values({ name: `Halle ${counter}`, kind: 'venue', address_id: address.id })
    .returning()
    .get()
  const contact = db.insert(schema.contact).values({ email: promoterEmail }).returning().get()
  const person = db
    .insert(schema.person)
    .values({ first_name: 'Maik', last_name: `Probe${counter}`, contact_id: contact.id })
    .returning()
    .get()
  const event = db
    .insert(schema.deal_memo)
    .values({
      band_id: band.id,
      date,
      name: `Show ${counter}`,
      venue_id: venue.id,
      status: 'confirmed',
      lopro_person_id: person.id
    })
    .returning()
    .get()
  return { event, venue }
}

describe('a mail and its shows', () => {
  it('finds the show of the promoter contact with what the mail suggests', () => {
    const service = container.resolve(AdvancingService)
    const { event } = show('2026-12-04', 'maik@promoter.example.com')
    service.setStage({ eventId: event.id, status: 'contacted' }, '2026-11-10')
    service.saveQuota({ eventId: event.id, quota: 200, quotaNote: '' })

    const shows = service.forMail(
      {
        accountId: 'acc',
        messageId: null,
        fromEmail: 'Maik@Promoter.example.com',
        fromName: 'Maik Probe',
        toEmails: [],
        subject: 'Re: Advancing',
        snippet: 'Hi, Load-in 16 Uhr, aktuell 143 Tickets verkauft.'
      },
      TODAY
    )
    expect(shows).toHaveLength(1)
    expect(shows[0]).toMatchObject({
      eventId: event.id,
      status: 'contacted',
      statusDate: '2026-11-10',
      suggestedStatus: 'in_progress',
      suggestedSold: 143,
      quota: 200,
      senderIsLocalContact: false
    })
    // someone else at the promoter (same domain) belongs to the show as well
    expect(
      service.forMail(
        {
          accountId: 'acc',
          messageId: null,
          fromEmail: 'kasse@promoter.example.com',
          fromName: '',
          toEmails: [],
          subject: '',
          snippet: ''
        },
        TODAY
      )
    ).toHaveLength(1)
    // a show far ahead or a stranger's mail: nothing
    expect(
      service.forMail(
        {
          accountId: 'acc',
          messageId: null,
          fromEmail: 'someone@gmail.com',
          fromName: '',
          toEmails: [],
          subject: '',
          snippet: ''
        },
        TODAY
      )
    ).toEqual([])
  })

  it('makes the sender the contact on site, with the club for its next show', () => {
    const service = container.resolve(AdvancingService)
    const { event, venue } = show('2026-12-11', 'promo@konzerte.example.com')
    const saved = service.localContactFromMail({
      eventId: event.id,
      email: 'Jo.Vorort@club.example.org',
      name: 'Jo Vorort'
    })
    expect(saved.localContact).toMatchObject({
      name: 'Jo Vorort',
      email: 'jo.vorort@club.example.org'
    })
    const member = db
      .select()
      .from(schema.venue_member)
      .where(
        and(
          eq(schema.venue_member.venue_id, venue.id),
          eq(schema.venue_member.person_id, saved.localContact!.id)
        )
      )
      .get()
    expect(member?.role).toBe('Kontakt vor Ort')

    // a mail of the same address does not create a second person
    const again = service.localContactFromMail({
      eventId: event.id,
      email: 'jo.vorort@club.example.org',
      name: ''
    })
    expect(again.localContact!.id).toBe(saved.localContact!.id)
  })

  it('marks a show contacted once its advancing mail went out, never back from further on', () => {
    const service = container.resolve(AdvancingService)
    const { event } = show('2026-12-12', 'a@b.example.com')
    service.markContacted(event.id, TODAY)
    expect(service.get(event.id)).toMatchObject({ status: 'contacted', statusDate: TODAY })
    service.setStage({ eventId: event.id, status: 'done' }, TODAY)
    service.markContacted(event.id, '2026-11-20')
    expect(service.get(event.id).status).toBe('done')
  })
})

describe('open points of advancing and tickets', () => {
  it('lists advancing not done within three weeks and old sales reports', async () => {
    const service = container.resolve(AdvancingService)
    const openItems = container.resolve(OpenItemsService)
    const soon = show('2026-12-01', 'x@soon.example.com').event
    const later = show('2027-02-01', 'x@later.example.com').event
    service.setStage({ eventId: soon.id, status: 'contacted' }, '2026-11-05')
    service.saveQuota({ eventId: later.id, quota: 300, quotaNote: '' })
    service.saveReport({ eventId: later.id, reportDate: '2026-10-20', sold: 50, note: '' })

    const soonItems = await openItems.list(soon.id, TODAY)
    const advancing = soonItems.find((item) => item.kind === 'advancing')!
    expect(advancing).toMatchObject({ advancingStatus: 'contacted', advancingSince: '2026-11-05' })
    expect(openItemText(advancing, TODAY)).toBe(
      'Show am 01.12.2026: Advancing seit 05.11.2026 angeschrieben, noch keine Antwort'
    )
    expect(openItemTab(advancing)).toBe('advancing')

    const laterItems = await openItems.list(later.id, TODAY)
    expect(laterItems.map((item) => item.kind)).toEqual(['tickets'])
    expect(openItemText(laterItems[0], TODAY)).toBe(
      'Show am 01.02.2027: letzte Ticketmeldung vom 20.10.2026'
    )

    // done and freshly reported: nothing open
    service.setStage({ eventId: soon.id, status: 'done' }, TODAY)
    service.saveReport({ eventId: later.id, reportDate: TODAY, sold: 80, note: '' })
    expect((await openItems.list(soon.id, TODAY)).map((item) => item.kind)).not.toContain(
      'advancing'
    )
    expect(await openItems.list(later.id, TODAY)).toEqual([])
  })
})
