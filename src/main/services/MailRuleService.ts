import { injectable, inject } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import { mailClient } from '../mailclient/MailClientService'
import type { FolderNode, RuleMatch, RuleMatcher, RuleMatchPage } from '../mailclient/core/types'
import { MailRuleRepository, type MailRuleRow } from '../repositories/MailRuleRepository'
import { SettingsRepository } from '../repositories/SettingsRepository'
import {
  ruleAlternatives,
  type MailRuleDto,
  type MailRuleLinkType,
  type MoveMailRuleInput,
  type SaveMailRuleInput,
  type SetMailRuleEnabledInput
} from '../api/schemas/mailRule.schema'
import { MailLinkService, type LinkCursor } from './MailLinkService'

/**
 * #124: rules for incoming mail. After each sync of an account's INBOX the worker matches the
 * new mails against the account's rules (the subject and the addresses never leave it); this
 * service carries out what the matching rules say: mark read, flag, move on the server and link
 * to a record.
 *
 * A rule never touches the mailbox it finds: it applies to mail received from the moment it was
 * created or switched on (`active_since`, less a few minutes for the server's clock). The first
 * download of an account and a rebuilt store therefore file nothing old. A mail a rule handled
 * is remembered, so one the user moves back into the INBOX stays there.
 */

/** Mails per matching round; the run yields between rounds */
export const RULE_BATCH = 500
/** The server's clock may be a little behind ours */
export const RULE_CLOCK_GRACE_MS = 10 * 60 * 1000

/** The INBOX is where rules look; other folders never trigger a run */
export const ruleFolder = (folder: { path?: string }): boolean =>
  folder.path?.toUpperCase() === 'INBOX'

const LINK_TABLES = {
  person: schema.person,
  company: schema.company,
  venue: schema.venue,
  band: schema.band,
  event: schema.deal_memo
} as const

/** The record a rule links to, by name; null when it no longer exists */
export function recordLabel(type: MailRuleLinkType, id: number): string | null {
  switch (type) {
    case 'person': {
      const row = db
        .select({ first: schema.person.first_name, last: schema.person.last_name })
        .from(schema.person)
        .where(eq(schema.person.id, id))
        .get()
      return row ? [row.first, row.last].filter(Boolean).join(' ') || `Person ${id}` : null
    }
    case 'event': {
      const row = db
        .select({ name: schema.deal_memo.name, date: schema.deal_memo.date })
        .from(schema.deal_memo)
        .where(eq(schema.deal_memo.id, id))
        .get()
      // 2026-06-11 -> 11.06.2026, as the follow-ups name an event
      return row ? `${row.name} (${row.date.split('-').reverse().join('.')})` : null
    }
    default: {
      const table = LINK_TABLES[type]
      const row = db.select({ name: table.name }).from(table).where(eq(table.id, id)).get()
      return row ? row.name : null
    }
  }
}

/** What main hands the worker for one rule */
export function toMatcher(rule: MailRuleRow): RuleMatcher {
  const subject = rule.match_subject.trim()
  return {
    id: rule.id,
    from: ruleAlternatives(rule.match_from),
    to: ruleAlternatives(rule.match_to),
    subject: subject ? [subject] : []
  }
}

/** The rules of `ruleIds` that may still act on a mail received at `receivedAt` */
export function applicableRules(
  rules: readonly MailRuleRow[],
  match: Pick<RuleMatch, 'ruleIds' | 'receivedAt'>,
  handled: (ruleId: number) => boolean
): MailRuleRow[] {
  const received = Date.parse(match.receivedAt ?? '')
  // Without a date nobody can tell whether the mail is new; leave it alone
  if (Number.isNaN(received)) return []
  return match.ruleIds
    .map((id) => rules.find((rule) => rule.id === id))
    .filter((rule): rule is MailRuleRow => rule !== undefined)
    .filter((rule) => received >= Date.parse(rule.active_since) - RULE_CLOCK_GRACE_MS)
    .filter((rule) => !handled(rule.id))
}

/** What one page of matches asks the mailbox for */
export type RulePlan = {
  markRead: number[]
  markFlagged: number[]
  /** target folder path -> store row ids */
  moves: Map<string, number[]>
  /** rule id -> the mail keys it handled */
  handled: Map<number, string[]>
  /** Rules that matched but could do nothing: only server writes on a "Nur lesen" account */
  blocked: Set<number>
  links: { rule: MailRuleRow; match: RuleMatch }[]
  /** rule id -> the store row ids its move or flags concern, to name the rule on an error */
  writesOf: Map<number, number[]>
}

/** Marking and moving change the mailbox on the server */
export const hasWrites = (rule: MailRuleRow): boolean =>
  rule.mark_read || rule.mark_flagged || rule.move_to_folder_path !== null

export const mailKey = (match: Pick<RuleMatch, 'messageId' | 'fallbackKey'>): string =>
  match.messageId ? `id:${match.messageId}` : `fb:${match.fallbackKey}`

/**
 * One page of matches as actions. Server writes only when the account may be written to; the
 * first matching rule with a folder moves, later ones with a folder only mark and link.
 */
export function planRules(
  rules: readonly MailRuleRow[],
  matches: readonly RuleMatch[],
  handled: (ruleId: number, key: string) => boolean,
  canWrite: boolean
): RulePlan {
  const plan: RulePlan = {
    markRead: [],
    markFlagged: [],
    moves: new Map(),
    handled: new Map(),
    blocked: new Set(),
    links: [],
    writesOf: new Map()
  }
  const write = (rule: MailRuleRow, id: number): void => {
    plan.writesOf.set(rule.id, [...(plan.writesOf.get(rule.id) ?? []), id])
  }
  for (const match of matches) {
    const key = mailKey(match)
    const acting = applicableRules(rules, match, (ruleId) => handled(ruleId, key))
    if (acting.length === 0) continue
    let read = false
    let flag = false
    let target: string | null = null
    for (const rule of acting) {
      const links = rule.link_entity_type !== null && rule.link_entity_id !== null
      if (!canWrite && hasWrites(rule)) plan.blocked.add(rule.id)
      // Nothing it may do here: not handled, so it does not count either
      if (!canWrite && !links) continue
      plan.handled.set(rule.id, [...(plan.handled.get(rule.id) ?? []), key])
      if (links) plan.links.push({ rule, match })
      if (!canWrite) continue
      if (rule.mark_read && !match.seen) {
        read = true
        write(rule, match.id)
      }
      if (rule.mark_flagged && !match.flagged) {
        flag = true
        write(rule, match.id)
      }
      if (rule.move_to_folder_path && target === null) {
        target = rule.move_to_folder_path
        write(rule, match.id)
      }
    }
    if (read) plan.markRead.push(match.id)
    if (flag) plan.markFlagged.push(match.id)
    if (target !== null) plan.moves.set(target, [...(plan.moves.get(target) ?? []), match.id])
  }
  return plan
}

/** Folder paths to ids, through the whole tree */
function folderIds(
  nodes: readonly FolderNode[],
  out = new Map<string, string>()
): Map<string, string> {
  for (const node of nodes) {
    out.set(node.path, node.id)
    folderIds(node.children ?? [], out)
  }
  return out
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const READ_ONLY_NOTE =
  'Das Konto ist auf „Nur lesen“ gestellt: Markieren und Verschieben wurden übersprungen.'

@injectable()
export class MailRuleService {
  constructor(
    @inject(MailRuleRepository) private repository: MailRuleRepository,
    @inject(SettingsRepository) private settings: SettingsRepository,
    @inject(MailLinkService) private links: MailLinkService
  ) {}

  private toDto(row: MailRuleRow): MailRuleDto {
    const linkType = row.link_entity_type as MailRuleLinkType | null
    return {
      id: row.id,
      accountId: row.mail_account_id,
      name: row.name,
      enabled: row.enabled,
      position: row.position,
      matchFrom: row.match_from,
      matchTo: row.match_to,
      matchSubject: row.match_subject,
      moveToFolderPath: row.move_to_folder_path,
      markRead: row.mark_read,
      markFlagged: row.mark_flagged,
      link:
        linkType && row.link_entity_id !== null
          ? {
              entityType: linkType,
              entityId: row.link_entity_id,
              label: recordLabel(linkType, row.link_entity_id)
            }
          : null,
      hitCount: row.hit_count,
      lastAppliedAt: row.last_applied_at,
      lastError: row.last_error
    }
  }

  list(): MailRuleDto[] {
    return this.repository.list().map((row) => this.toDto(row))
  }

  save(input: SaveMailRuleInput, now = new Date()): MailRuleDto {
    if (input.link && recordLabel(input.link.entityType, input.link.entityId) === null) {
      throw new Error('Der Datensatz existiert nicht mehr')
    }
    const values = {
      mail_account_id: input.accountId,
      name: input.name,
      enabled: input.enabled,
      match_from: input.matchFrom,
      match_to: input.matchTo,
      match_subject: input.matchSubject,
      move_to_folder_path: input.moveToFolderPath,
      mark_read: input.markRead,
      mark_flagged: input.markFlagged,
      link_entity_type: input.link?.entityType ?? null,
      link_entity_id: input.link?.entityId ?? null
    }
    if (input.id === undefined) {
      return this.toDto(this.repository.insert({ ...values, active_since: now.toISOString() }))
    }
    const existing = this.repository.get(input.id)
    if (!existing) throw new Error('Regel nicht gefunden')
    // Moved to another account: last in that account's order
    if (existing.mail_account_id !== input.accountId) {
      this.repository.delete(existing.id)
      return this.toDto(this.repository.insert({ ...values, active_since: now.toISOString() }))
    }
    const row = this.repository.update(input.id, {
      ...values,
      // Switched back on: from now on, not for what came while it was off
      active_since: !existing.enabled && input.enabled ? now.toISOString() : existing.active_since,
      // Edited: the next run says whether it still fails
      last_error: null
    })
    if (!row) throw new Error('Regel nicht gefunden')
    return this.toDto(row)
  }

  setEnabled(input: SetMailRuleEnabledInput, now = new Date()): MailRuleDto {
    const existing = this.repository.get(input.id)
    if (!existing) throw new Error('Regel nicht gefunden')
    const row = this.repository.update(input.id, {
      enabled: input.enabled,
      active_since: !existing.enabled && input.enabled ? now.toISOString() : existing.active_since
    })
    if (!row) throw new Error('Regel nicht gefunden')
    return this.toDto(row)
  }

  /** One step up or down in its account's order */
  move(input: MoveMailRuleInput): void {
    const existing = this.repository.get(input.id)
    if (!existing) throw new Error('Regel nicht gefunden')
    const rows = this.repository.renumber(existing.mail_account_id)
    const index = rows.findIndex((row) => row.id === input.id)
    const other = rows[input.direction === 'up' ? index - 1 : index + 1]
    if (other) this.repository.swapPositions(rows[index], other)
  }

  delete(id: number): void {
    this.repository.delete(id)
  }

  private cursorKey(accountId: string): string {
    return `mailRuleCursor:${accountId}`
  }

  /** Stored cursor per account; a missing or broken value starts at 0 of no store */
  cursorFor(accountId: string): LinkCursor {
    const start: LinkCursor = { generation: null, id: 0 }
    const raw = this.settings.getAll()[this.cursorKey(accountId)]
    if (raw === undefined) return start
    try {
      const parsed = JSON.parse(raw) as { generation?: unknown; id?: unknown } | null
      if (typeof parsed?.generation !== 'string' || typeof parsed.id !== 'number') return start
      if (!Number.isInteger(parsed.id) || parsed.id < 0) return start
      return { generation: parsed.generation, id: parsed.id }
    } catch {
      return start
    }
  }

  private saveCursor(accountId: string, cursor: LinkCursor): void {
    this.settings.setMany({ [this.cursorKey(accountId)]: JSON.stringify(cursor) })
  }

  /**
   * One run for an account: the INBOX mails after the stored cursor, in batches. The cursor
   * names its store like the linker's (MR-28); a rebuilt store starts again at 0, and
   * `active_since` plus the handled mails keep that from doing anything twice.
   * Returns how many mails the rules handled.
   */
  async applyRules(accountId: string, canWrite: boolean, now = () => new Date()): Promise<number> {
    const rules = this.repository.enabledFor(accountId)
    if (rules.length === 0) return 0
    const matchers = rules.map(toMatcher)
    let { generation, id: cursor } = this.cursorFor(accountId)
    let folders: Map<string, string> | null = null
    let total = 0
    for (;;) {
      const page = (await mailClient.call('matchInboxSince', [
        cursor,
        RULE_BATCH,
        matchers,
        accountId
      ])) as RuleMatchPage
      if (page.generation !== generation) {
        generation = page.generation
        // These ids belong to another store; the old position says nothing about them
        if (cursor > 0) {
          cursor = 0
          this.saveCursor(accountId, { generation, id: cursor })
          continue
        }
      }
      if (page.scanned === 0) break

      const keys = page.matches.map(mailKey)
      const seen = this.repository.hitsAmong(
        rules.map((rule) => rule.id),
        keys
      )
      const plan = planRules(
        rules,
        page.matches,
        (ruleId, key) => seen.has(`${ruleId}:${key}`),
        canWrite
      )
      const errors = new Map<number, string>()
      const failed = (ids: number[], message: string): void => {
        for (const [ruleId, rows] of plan.writesOf) {
          if (rows.some((id) => ids.includes(id)) && !errors.has(ruleId))
            errors.set(ruleId, message)
        }
      }

      // Flags first: a move gives the mail a new row id
      if (plan.markRead.length > 0) {
        await mailClient
          .call('markRead', [plan.markRead, true, accountId])
          .catch((error) => failed(plan.markRead, errorText(error)))
      }
      if (plan.markFlagged.length > 0) {
        await mailClient
          .call('markFlagged', [plan.markFlagged, true, accountId])
          .catch((error) => failed(plan.markFlagged, errorText(error)))
      }
      for (const [path, ids] of plan.moves) {
        try {
          folders ??= folderIds((await mailClient.call('getFolders', [accountId])) as FolderNode[])
          const folderId = folders.get(path)
          if (!folderId) {
            failed(ids, `Ordner „${path}“ nicht gefunden`)
            continue
          }
          await mailClient.call('moveToFolder', [ids, folderId, accountId])
        } catch (error) {
          failed(ids, errorText(error))
        }
      }
      for (const { rule, match } of plan.links) {
        const type = rule.link_entity_type as MailRuleLinkType
        const id = rule.link_entity_id!
        if (recordLabel(type, id) === null) {
          if (!errors.has(rule.id))
            errors.set(rule.id, 'Der verknüpfte Datensatz existiert nicht mehr')
          continue
        }
        this.links.insertLink({
          accountId,
          messageId: match.messageId,
          fallbackKey: match.fallbackKey,
          entityType: type,
          entityId: id,
          source: 'rule',
          mailDate: match.date ?? match.receivedAt
        })
      }

      const appliedAt = now().toISOString()
      for (const [ruleId, handledKeys] of plan.handled) {
        const note = plan.blocked.has(ruleId) ? READ_ONLY_NOTE : null
        this.repository.recordRun(ruleId, handledKeys, appliedAt, errors.get(ruleId) ?? note)
        total += handledKeys.length
      }
      for (const ruleId of plan.blocked) {
        if (!plan.handled.has(ruleId)) this.repository.noteError(ruleId, READ_ONLY_NOTE)
      }

      cursor = Math.max(cursor, page.lastId)
      this.saveCursor(accountId, { generation, id: cursor })
      // Yield: the sync must never wait for the rules
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return total
  }
}
