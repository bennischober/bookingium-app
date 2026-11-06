// #124: rules for incoming mail. The matching is pure (core/mail_rules.ts); the service runs
// against the real in-memory app database with the worker stubbed, so no mailbox is touched.
// Invented data only.
import 'reflect-metadata'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { container } from 'tsyringe'
import { setupTestDb, getTestDb } from './helpers/setup'
import { matchingRules, recipientsOf, ruleMatches } from '../src/main/mailclient/core/mail_rules'
import { Store } from '../src/main/mailclient/core/store'
import { createMailCore, type MailCore } from '../src/main/mailclient/core/index'
import type { FolderNode, RuleMatch, RuleMatcher } from '../src/main/mailclient/core/types'
import { SaveMailRuleInput, ruleAlternatives } from '../src/main/api/schemas/mailRule.schema'
import {
  MailRuleService,
  RULE_CLOCK_GRACE_MS,
  applicableRules,
  mailKey,
  planRules,
  ruleFolder,
  toMatcher
} from '../src/main/services/MailRuleService'
import type { MailRuleRow } from '../src/main/repositories/MailRuleRepository'

setupTestDb()

const sqlite = () => getTestDb().sqlite

beforeEach(() => {
  for (const table of [
    'mail_rule_hit',
    'mail_rule',
    'mail_link',
    'person',
    'venue',
    'app_setting'
  ]) {
    sqlite().prepare(`DELETE FROM ${table}`).run()
  }
})

const matcher = (over: Partial<RuleMatcher> = {}): RuleMatcher => ({
  id: 1,
  from: [],
  to: [],
  subject: [],
  ...over
})

const mail = {
  fromEmail: 'booking@agentur.example.test',
  fromName: 'Erika Musterfrau',
  recipients: ['info@club.example.test', 'Max Mustermann'],
  subject: 'Anfrage Sommerfestival'
}

describe('rule matching (core)', () => {
  it('matches a part of the sender address or name, ignoring case', () => {
    expect(ruleMatches(matcher({ from: ['AGENTUR.example.test'] }), mail)).toBe(true)
    expect(ruleMatches(matcher({ from: ['musterfrau'] }), mail)).toBe(true)
    expect(ruleMatches(matcher({ from: ['andere.example.test'] }), mail)).toBe(false)
  })

  it('needs every named condition, but one alternative of each', () => {
    const both = matcher({ from: ['nobody', 'agentur'], subject: ['festival'] })
    expect(ruleMatches(both, mail)).toBe(true)
    expect(ruleMatches({ ...both, subject: ['absage'] }, mail)).toBe(false)
  })

  it('looks at To and Cc by address and name', () => {
    expect(ruleMatches(matcher({ to: ['info@club'] }), mail)).toBe(true)
    expect(ruleMatches(matcher({ to: ['mustermann'] }), mail)).toBe(true)
    expect(ruleMatches(matcher({ to: ['agentur'] }), mail)).toBe(false)
  })

  it('matches nothing without a condition, blank ones included', () => {
    expect(ruleMatches(matcher(), mail)).toBe(false)
    expect(ruleMatches(matcher({ from: ['  '] }), mail)).toBe(false)
  })

  it('returns the matching rules in the order given', () => {
    const rules = [
      matcher({ id: 7, subject: ['festival'] }),
      matcher({ id: 3, subject: ['absage'] }),
      matcher({ id: 5, from: ['agentur'] })
    ]
    expect(matchingRules(rules, mail)).toEqual([7, 5])
  })

  it('reads To/Cc JSON and tolerates junk', () => {
    expect(
      recipientsOf('[{"email":"a@example.test","name":"A"},{"email":"b@example.test"}]')
    ).toEqual(['a@example.test', 'A', 'b@example.test'])
    expect(recipientsOf(null)).toEqual([])
    expect(recipientsOf('not json')).toEqual([])
    expect(recipientsOf('{"email":"x"}')).toEqual([])
  })

  it('splits a condition into alternatives on comma and semicolon', () => {
    expect(ruleAlternatives(' a@example.test, b.example.test ;; c ')).toEqual([
      'a@example.test',
      'b.example.test',
      'c'
    ])
    expect(ruleAlternatives('')).toEqual([])
  })
})

describe('the rule input', () => {
  const base = {
    accountId: 'acc',
    name: 'Regel',
    enabled: true,
    matchFrom: 'agentur',
    matchTo: '',
    matchSubject: '',
    moveToFolderPath: null,
    markRead: true,
    markFlagged: false,
    link: null
  }

  it('needs a condition and an action', () => {
    expect(SaveMailRuleInput.safeParse(base).success).toBe(true)
    expect(SaveMailRuleInput.safeParse({ ...base, matchFrom: '  ' }).success).toBe(false)
    expect(SaveMailRuleInput.safeParse({ ...base, markRead: false }).success).toBe(false)
  })
})

describe('matching in the store (core)', () => {
  const ACCOUNT = 'rules'
  const cleanups: (() => unknown)[] = []
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!()
  })

  function addMail(
    store: Store,
    folderId: string,
    n: number,
    over: { from?: string; to?: string; flags?: string; internal?: string | null } = {}
  ): number {
    return store.insertMessage({
      account_id: ACCOUNT,
      folder_id: folderId,
      uid: n,
      message_key: `rules-${n}`,
      file_path: `rules-${n}.eml`,
      message_id: `<rules-${n}@example.test>`,
      in_reply_to: null,
      references_json: '[]',
      thread_id: null,
      date: '2026-10-01T12:00:00.000Z',
      internal_date: over.internal === undefined ? '2026-10-01T12:05:00.000Z' : over.internal,
      subject: `Anfrage ${n}`,
      from_name: 'Absender',
      from_email: over.from ?? 'booking@agentur.example.test',
      to_json: over.to ?? '[]',
      cc_json: '[]',
      bcc_json: '[]',
      flags_json:
        over.flags ??
        '{"seen":false,"flagged":false,"draft":false,"deleted":false,"answered":false}',
      modseq: null,
      has_attachments: 0,
      attachments_json: '[]',
      size_bytes: 1000 + n,
      body_text: 'plain',
      body_html: null,
      snippet: '',
      parsed_ok: 1,
      parse_error: null
    })
  }

  function openCore(seed: (store: Store) => void): MailCore {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-rules-'))
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
    const storeDir = path.join(dir, ACCOUNT)
    fs.mkdirSync(storeDir, { recursive: true })
    const store = new Store(storeDir, ACCOUNT)
    seed(store)
    store.close()
    const api = createMailCore({
      dataDir: dir,
      accounts: [
        {
          id: ACCOUNT,
          readOnly: false,
          email: 'rules@example.test',
          host: '127.0.0.1',
          port: 1,
          security: 'none',
          credentials: async () => ({ user: 'rules@example.test', pass: 'x' })
        }
      ]
    }) as MailCore
    cleanups.push(() => api.close())
    return api
  }

  it('matches INBOX mail only, and pages over every folder', async () => {
    let generation = ''
    const api = openCore((store) => {
      const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
      const archive = store.upsertFolder({ imapPath: 'Archiv', delimiter: '/', uidValidity: '1' })
      addMail(store, inbox.id, 1)
      addMail(store, archive.id, 2)
      addMail(store, inbox.id, 3, {
        flags: '{"seen":true,"flagged":true}',
        internal: null
      })
      addMail(store, inbox.id, 4, { from: 'jemand@example.test' })
      addMail(store, inbox.id, 5, {
        from: 'jemand@example.test',
        to: '[{"email":"info@club.example.test","name":"Club"}]'
      })
      generation = store.generation()
    })
    const rules = [matcher({ id: 1, from: ['agentur'] }), matcher({ id: 2, to: ['club'] })]

    const first = await api.matchInboxSince(0, 3, rules, ACCOUNT)
    expect(first.generation).toBe(generation)
    expect(first.scanned).toBe(3)
    expect(first.matches.map((m) => m.id)).toEqual([1, 3])
    expect(first.matches[0]).toMatchObject({
      messageId: 'rules-1@example.test',
      receivedAt: '2026-10-01T12:05:00.000Z',
      date: '2026-10-01T12:00:00.000Z',
      seen: false,
      flagged: false,
      ruleIds: [1]
    })
    // Without an internal date the header date stands in
    expect(first.matches[1]).toMatchObject({
      receivedAt: '2026-10-01T12:00:00.000Z',
      seen: true,
      flagged: true
    })

    const next = await api.matchInboxSince(first.lastId, 3, rules, ACCOUNT)
    expect(next.scanned).toBe(2)
    expect(next.matches.map((m) => [m.id, m.ruleIds])).toEqual([[5, [2]]])

    const end = await api.matchInboxSince(next.lastId, 3, rules, ACCOUNT)
    expect(end).toMatchObject({ scanned: 0, lastId: next.lastId, matches: [] })
  })
})

/** A stored rule as the repository returns it */
const row = (over: Partial<MailRuleRow> = {}): MailRuleRow => ({
  id: 1,
  mail_account_id: 'acc',
  name: 'Regel',
  enabled: true,
  position: 0,
  match_from: 'agentur',
  match_to: '',
  match_subject: '',
  move_to_folder_path: null,
  mark_read: false,
  mark_flagged: false,
  link_entity_type: null,
  link_entity_id: null,
  active_since: '2026-10-01T10:00:00.000Z',
  hit_count: 0,
  last_applied_at: null,
  last_error: null,
  created_at: '2026-10-01 10:00:00',
  updated_at: '2026-10-01 10:00:00',
  ...over
})

const match = (over: Partial<RuleMatch> = {}): RuleMatch => ({
  id: 10,
  messageId: 'm10@example.test',
  fallbackKey: 'fb-10',
  receivedAt: '2026-10-02T08:00:00.000Z',
  date: '2026-10-02T07:59:00.000Z',
  seen: false,
  flagged: false,
  ruleIds: [1],
  ...over
})

describe('which rules act on a mail', () => {
  it('runs on INBOX syncs only', () => {
    expect(ruleFolder({ path: 'INBOX' })).toBe(true)
    expect(ruleFolder({ path: 'Archiv' })).toBe(false)
    expect(ruleFolder({})).toBe(false)
  })

  it('acts on mail received since the rule was switched on, with the clock grace', () => {
    const rules = [row()]
    const since = Date.parse(rules[0].active_since)
    const at = (ms: number) => new Date(ms).toISOString()
    const none = () => false
    expect(applicableRules(rules, match({ receivedAt: at(since + 1) }), none)).toHaveLength(1)
    expect(
      applicableRules(rules, match({ receivedAt: at(since - RULE_CLOCK_GRACE_MS + 1) }), none)
    ).toHaveLength(1)
    expect(
      applicableRules(rules, match({ receivedAt: at(since - RULE_CLOCK_GRACE_MS - 1) }), none)
    ).toHaveLength(0)
    // No date: nobody can tell whether the mail is new
    expect(applicableRules(rules, match({ receivedAt: null }), none)).toHaveLength(0)
    expect(applicableRules(rules, match({ receivedAt: 'gestern' }), none)).toHaveLength(0)
  })

  it('skips a mail the rule has handled before', () => {
    expect(applicableRules([row()], match(), () => true)).toHaveLength(0)
  })

  it('keys a mail by its Message-ID, else by the fallback key', () => {
    expect(mailKey(match())).toBe('id:m10@example.test')
    expect(mailKey(match({ messageId: null }))).toBe('fb:fb-10')
  })

  it('hands the conditions to the worker as lists', () => {
    expect(
      toMatcher(row({ match_from: 'a, b', match_to: '', match_subject: ' Festival, Open Air ' }))
    ).toEqual({ id: 1, from: ['a', 'b'], to: [], subject: ['Festival, Open Air'] })
  })
})

describe('planning a page of matches', () => {
  const none = () => false

  it('moves to the folder of the first matching rule, marks for all', () => {
    const rules = [
      row({ id: 1, move_to_folder_path: 'Anfragen' }),
      row({ id: 2, move_to_folder_path: 'Andere', mark_flagged: true })
    ]
    const plan = planRules(rules, [match({ ruleIds: [1, 2] })], none, true)
    expect([...plan.moves]).toEqual([['Anfragen', [10]]])
    expect(plan.markFlagged).toEqual([10])
    expect(plan.markRead).toEqual([])
    expect([...plan.handled]).toEqual([
      [1, ['id:m10@example.test']],
      [2, ['id:m10@example.test']]
    ])
  })

  it('does not mark what is already marked', () => {
    const rules = [row({ mark_read: true, mark_flagged: true })]
    const plan = planRules(rules, [match({ seen: true, flagged: true })], none, true)
    expect(plan.markRead).toEqual([])
    expect(plan.markFlagged).toEqual([])
    expect(plan.handled.get(1)).toEqual(['id:m10@example.test'])
  })

  it('only links on a read-only account, and a write-only rule is not counted', () => {
    const rules = [
      row({ id: 1, mark_read: true, link_entity_type: 'band', link_entity_id: 4 }),
      row({ id: 2, move_to_folder_path: 'Anfragen' })
    ]
    const plan = planRules(rules, [match({ ruleIds: [1, 2] })], none, false)
    expect(plan.markRead).toEqual([])
    expect(plan.moves.size).toBe(0)
    expect(plan.links.map((l) => l.rule.id)).toEqual([1])
    expect([...plan.handled.keys()]).toEqual([1])
    expect([...plan.blocked]).toEqual([1, 2])
  })
})

describe('MailRuleService', () => {
  const service = () => container.resolve(MailRuleService)
  const ON = new Date('2026-10-01T10:00:00.000Z')

  const input = (over: Partial<SaveMailRuleInput> = {}): SaveMailRuleInput => ({
    accountId: 'acc',
    name: 'Anfragen',
    enabled: true,
    matchFrom: 'agentur.example.test',
    matchTo: '',
    matchSubject: '',
    moveToFolderPath: null,
    markRead: true,
    markFlagged: false,
    link: null,
    ...over
  })

  function seedVenue(name = 'Beispielhalle'): number {
    return Number(sqlite().prepare('INSERT INTO venue (name) VALUES (?)').run(name).lastInsertRowid)
  }

  const folders: FolderNode[] = [
    {
      id: 'f-inbox',
      path: 'INBOX',
      name: 'INBOX',
      delimiter: '/',
      specialUse: null,
      unreadCount: 0,
      totalCount: 0,
      children: [
        {
          id: 'f-anfragen',
          path: 'INBOX/Anfragen',
          name: 'Anfragen',
          delimiter: '/',
          specialUse: null,
          unreadCount: 0,
          totalCount: 0,
          children: []
        }
      ]
    }
  ]

  type Call = [string, unknown[]]
  let restore: (() => void) | null = null
  afterEach(() => {
    restore?.()
    restore = null
  })

  /**
   * Stands in for the worker: `matchInboxSince` pages through `mails` (matched against the
   * matchers it is given, by sender), the writes are recorded.
   */
  async function stubWorker(
    mails: (Omit<RuleMatch, 'ruleIds'> & { from: string })[],
    options: { generation?: () => string; fail?: string } = {}
  ): Promise<Call[]> {
    const { mailClient } = await import('../src/main/mailclient/MailClientService')
    const call = mailClient.call.bind(mailClient)
    const calls: Call[] = []
    mailClient.call = (async (method: string, args: unknown[]) => {
      calls.push([method, args])
      if (method === options.fail) throw new Error('Server antwortet nicht')
      if (method === 'getFolders') return folders
      if (method !== 'matchInboxSince') return []
      const [cursor, limit, matchers] = args as [number, number, RuleMatcher[]]
      const rows = mails.filter((m) => m.id > cursor).slice(0, limit)
      return {
        generation: options.generation?.() ?? 'gen-1',
        lastId: rows.length > 0 ? rows[rows.length - 1].id : cursor,
        scanned: rows.length,
        matches: rows
          .map(({ from, ...m }) => ({
            ...m,
            ruleIds: matchers.filter((r) => r.from.some((f) => from.includes(f))).map((r) => r.id)
          }))
          .filter((m) => m.ruleIds.length > 0)
      }
    }) as never
    restore = () => (mailClient.call = call as never)
    return calls
  }

  const inbox = (id: number, over: Partial<RuleMatch> & { from?: string } = {}) => ({
    from: 'booking@agentur.example.test',
    ...match({ id, messageId: `m${id}@example.test`, fallbackKey: `fb-${id}` }),
    ...over
  })

  const writes = (calls: Call[]) => calls.filter(([method]) => method !== 'matchInboxSince')

  it('marks, moves and links new mail on a writable account', async () => {
    const venueId = seedVenue()
    const rule = service().save(
      input({
        moveToFolderPath: 'INBOX/Anfragen',
        markFlagged: true,
        link: { entityType: 'venue', entityId: venueId }
      }),
      ON
    )
    const calls = await stubWorker([
      inbox(1, { receivedAt: '2026-09-01T00:00:00.000Z' }), // before the rule existed
      inbox(2),
      inbox(3, { from: 'someone@example.test' }), // matches nothing
      inbox(4, { seen: true })
    ])
    const handled = await service().applyRules('acc', true, () => new Date('2026-10-02T09:00:00Z'))

    expect(handled).toBe(2)
    expect(writes(calls)).toEqual([
      ['markRead', [[2], true, 'acc']],
      ['markFlagged', [[2, 4], true, 'acc']],
      ['getFolders', ['acc']],
      ['moveToFolder', [[2, 4], 'f-anfragen', 'acc']]
    ])
    const links = sqlite()
      .prepare(
        'SELECT message_id, entity_type, entity_id, source FROM mail_link ORDER BY message_id'
      )
      .all()
    expect(links).toEqual([
      { message_id: 'm2@example.test', entity_type: 'venue', entity_id: venueId, source: 'rule' },
      { message_id: 'm4@example.test', entity_type: 'venue', entity_id: venueId, source: 'rule' }
    ])
    const [dto] = service().list()
    expect(dto).toMatchObject({
      id: rule.id,
      hitCount: 2,
      lastAppliedAt: '2026-10-02T09:00:00.000Z',
      lastError: null,
      link: { entityType: 'venue', entityId: venueId, label: 'Beispielhalle' }
    })
  })

  it('continues after the cursor and never handles a mail twice, even from a rebuilt store', async () => {
    service().save(input(), ON)
    let generation = 'gen-1'
    const mails = [inbox(1), inbox(2)]
    const calls = await stubWorker(mails, { generation: () => generation })
    await service().applyRules('acc', true)
    expect(writes(calls)).toEqual([['markRead', [[1, 2], true, 'acc']]])

    // The next sync brought one more mail: only that one
    mails.push(inbox(3))
    calls.length = 0
    await service().applyRules('acc', true)
    expect(calls[0]).toEqual(['matchInboxSince', [2, 500, expect.any(Array), 'acc']])
    expect(writes(calls)).toEqual([['markRead', [[3], true, 'acc']]])

    // A rebuilt store hands out the same mails again under new ids
    generation = 'gen-2'
    mails.splice(0, mails.length, inbox(1), inbox(2), inbox(3))
    calls.length = 0
    await service().applyRules('acc', true)
    expect(calls.filter(([m]) => m === 'matchInboxSince').map(([, a]) => a[0])).toEqual([3, 0, 3])
    expect(writes(calls)).toEqual([])
    expect(service().list()[0].hitCount).toBe(3)
  })

  it('only links on a "Nur lesen" account and says why', async () => {
    const venueId = seedVenue()
    service().save(input({ link: { entityType: 'venue', entityId: venueId } }), ON)
    service().save(
      input({ name: 'Nur verschieben', markRead: false, moveToFolderPath: 'INBOX/Anfragen' }),
      ON
    )
    const calls = await stubWorker([inbox(1)])
    await service().applyRules('acc', false)

    expect(writes(calls)).toEqual([])
    expect(sqlite().prepare('SELECT count(*) AS n FROM mail_link').get()).toEqual({ n: 1 })
    const [linking, moving] = service().list()
    expect(linking.hitCount).toBe(1)
    expect(linking.lastError).toMatch(/Nur lesen/)
    expect(moving.hitCount).toBe(0)
    expect(moving.lastError).toMatch(/Nur lesen/)
  })

  it('names a folder that no longer exists and a server that refused', async () => {
    service().save(input({ markRead: false, moveToFolderPath: 'Weg' }), ON)
    const calls = await stubWorker([inbox(1)])
    await service().applyRules('acc', true)
    expect(writes(calls).map(([m]) => m)).toEqual(['getFolders'])
    expect(service().list()[0]).toMatchObject({
      hitCount: 1,
      lastError: 'Ordner „Weg“ nicht gefunden'
    })

    restore?.()
    service().save(input({ name: 'Zweite' }), ON)
    await stubWorker([inbox(1), inbox(2)], { fail: 'markRead' })
    await service().applyRules('acc', true)
    expect(service().list()[1].lastError).toBe('Server antwortet nicht')
  })

  it('reports a linked record that was deleted', async () => {
    const venueId = seedVenue()
    service().save(input({ markRead: false, link: { entityType: 'venue', entityId: venueId } }), ON)
    sqlite().prepare('DELETE FROM venue').run()
    await stubWorker([inbox(1)])
    await service().applyRules('acc', true)
    expect(sqlite().prepare('SELECT count(*) AS n FROM mail_link').get()).toEqual({ n: 0 })
    expect(service().list()[0]).toMatchObject({
      link: { entityType: 'venue', entityId: venueId, label: null },
      lastError: 'Der verknüpfte Datensatz existiert nicht mehr'
    })
  })

  it('does nothing without a switched-on rule', async () => {
    const rule = service().save(input(), ON)
    service().setEnabled({ id: rule.id, enabled: false })
    const calls = await stubWorker([inbox(1)])
    expect(await service().applyRules('acc', true)).toBe(0)
    expect(calls).toEqual([])
  })

  it('starts a switched-on rule from that moment', () => {
    const rule = service().save(input(), ON)
    const later = new Date('2026-10-05T12:00:00.000Z')
    service().setEnabled({ id: rule.id, enabled: false }, later)
    const since = () =>
      (sqlite().prepare('SELECT active_since FROM mail_rule').get() as { active_since: string })
        .active_since
    expect(since()).toBe(ON.toISOString())
    service().setEnabled({ id: rule.id, enabled: true }, later)
    expect(since()).toBe(later.toISOString())
    // Editing a rule that stays on keeps its start
    service().save(input({ id: rule.id, name: 'Neu' }), new Date('2026-10-09T00:00:00.000Z'))
    expect(since()).toBe(later.toISOString())
  })

  it('keeps the order per account and moves rules up and down', () => {
    const a = service().save(input({ name: 'A' }), ON)
    const b = service().save(input({ name: 'B' }), ON)
    const c = service().save(input({ name: 'C' }), ON)
    const other = service().save(input({ name: 'X', accountId: 'other' }), ON)
    expect(other.position).toBe(0)
    const names = () =>
      service()
        .list()
        .filter((r) => r.accountId === 'acc')
        .map((r) => r.name)
    service().move({ id: c.id, direction: 'up' })
    expect(names()).toEqual(['A', 'C', 'B'])
    service().move({ id: a.id, direction: 'up' }) // already first
    service().move({ id: b.id, direction: 'down' }) // already last
    expect(names()).toEqual(['A', 'C', 'B'])
    service().delete(a.id)
    service().move({ id: b.id, direction: 'up' })
    expect(names()).toEqual(['B', 'C'])
  })

  it('refuses a link to a record that does not exist', () => {
    expect(() =>
      service().save(input({ link: { entityType: 'person', entityId: 999 } }), ON)
    ).toThrow('Der Datensatz existiert nicht mehr')
  })
})
