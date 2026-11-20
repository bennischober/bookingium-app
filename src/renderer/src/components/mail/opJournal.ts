import type { OpResult, OpSummary } from '../../../../main/mailclient/core/types'
import { t } from '../../../../main/i18n/translate'

// I3: the op-journal panel. The core keeps every write as a journaled op; most settle within a
// second and need no attention. This module decides which ones do, what the user can do with
// each, and how they are worded. Pure, so tests/mail_op_journal.test.ts covers it without a DOM.

/** An op that waits this long without an error is shown as stuck */
export const STUCK_MS = 2 * 60_000

/**
 * - unclear: a send the server may have; it is checked, never sent again
 * - rejected: the server said no (a conflict), or the op failed for good
 * - waiting: it failed and the core tries it again by itself
 * - stuck: no error, but it has neither run nor finished for a while
 */
export type OpAttention = 'unclear' | 'rejected' | 'waiting' | 'stuck'

/**
 * - resolve: look for the send in Sent (core resolveOp)
 * - retry: run it again now (core retryOp)
 * - discard: give it up (core cancelOp); its optimistic effect gives way to the server
 */
export type OpAction = 'resolve' | 'retry' | 'discard'

/** The core's own rule (resolveOp): a send in phase smtp may be at the server */
export function isUnclearSendOp(op: OpSummary): boolean {
  if (op.kind !== 'send') return false
  return op.state === 'unknown' || (op.state === 'conflict' && op.sendPhase === 'smtp')
}

/** Why this op needs the user, or null when it does not (done, cancelled, running normally) */
export function opAttention(op: OpSummary, now: number): OpAttention | null {
  if (isUnclearSendOp(op)) return 'unclear'
  if (op.state === 'conflict' || op.state === 'failed') return 'rejected'
  if (op.state === 'pending' && op.error) return 'waiting'
  if (op.state === 'pending' || op.state === 'running') {
    const since = Date.parse(op.updatedAt)
    return Number.isFinite(since) && now - since >= STUCK_MS ? 'stuck' : null
  }
  return null
}

/**
 * What the panel offers for an op. Mirrors what the core accepts: retryOp refuses an unclear
 * send, and a send is offered a retry only once the server has it (phase 'sent', filing only),
 * because anything earlier would deliver it again. A running op has no action: the core
 * refuses to cancel it, and the next start resumes it.
 */
export function opActions(op: OpSummary, attention: OpAttention): OpAction[] {
  if (attention === 'unclear') return ['resolve', 'discard']
  if (op.state === 'running') return []
  const retry = op.kind !== 'send' || op.sendPhase === 'sent'
  return retry ? ['retry', 'discard'] : ['discard']
}

const ORDER: Record<OpAttention, number> = { unclear: 0, rejected: 1, waiting: 2, stuck: 3 }

export type OpEntry = { op: OpSummary; attention: OpAttention; actions: OpAction[] }

/** The ops that need the user: unclear sends first, then the rest, newest first in each group */
export function opEntries(ops: readonly OpSummary[], now: number): OpEntry[] {
  const entries: OpEntry[] = []
  for (const op of ops) {
    const attention = opAttention(op, now)
    if (attention) entries.push({ op, attention, actions: opActions(op, attention) })
  }
  return entries.sort(
    (a, b) =>
      ORDER[a.attention] - ORDER[b.attention] || b.op.updatedAt.localeCompare(a.op.updatedAt)
  )
}

/** The header badge: how many ops need the user, and whether any needs a decision */
export function opBadge(entries: readonly OpEntry[]): { count: number; urgent: boolean } {
  return {
    count: entries.length,
    urgent: entries.some((e) => e.attention === 'unclear' || e.attention === 'rejected')
  }
}

const KIND_LABELS: Record<OpSummary['kind'], string> = {
  flag: t('Markierung ändern'),
  move: t('Verschieben'),
  move_batch: t('Mehrere E-Mails verschieben'),
  delete: t('In den Papierkorb'),
  expunge: t('Endgültig löschen'),
  send: t('Senden'),
  draft_save: t('Entwurf speichern'),
  draft_delete: t('Entwurf löschen'),
  folder_create: t('Ordner anlegen'),
  folder_rename: t('Ordner umbenennen'),
  folder_delete: t('Ordner löschen')
}

export function opKindLabel(kind: OpSummary['kind']): string {
  return KIND_LABELS[kind] ?? kind
}

export const ATTENTION_LABELS: Record<OpAttention, string> = {
  unclear: t('Versand unklar'),
  rejected: t('Abgelehnt'),
  waiting: t('Wartet auf neuen Versuch'),
  stuck: t('Hängt')
}

/** One sentence on what this state means for the user */
export function attentionHint(op: OpSummary, attention: OpAttention): string {
  switch (attention) {
    case 'unclear':
      return t(
        'Die Verbindung brach ab, nachdem die E-Mail übergeben wurde. Sie ist vielleicht schon beim Empfänger. Prüfen sucht sie im Ordner Gesendet und sendet nie ein zweites Mal.'
      )
    case 'rejected':
      return op.kind === 'send'
        ? t('Der Server hat das Ablegen im Ordner Gesendet abgelehnt.')
        : t(
            'Der Server hat die Änderung abgelehnt, meist weil sich das Postfach inzwischen geändert hat. Verwerfen zeigt wieder den Stand des Servers.'
          )
    case 'waiting':
      return t(
        'Fehlgeschlagen; Bookingium versucht es automatisch erneut, sobald die Verbindung steht.'
      )
    case 'stuck':
      return op.state === 'running'
        ? t(
            'Läuft seit einer Weile ohne Ergebnis; wird spätestens beim nächsten Start fortgesetzt.'
          )
        : t('Wartet seit einer Weile darauf, ausgeführt zu werden.')
  }
}

export const ACTION_LABELS: Record<OpAction, string> = {
  resolve: t('Im Ordner Gesendet prüfen'),
  retry: t('Erneut versuchen'),
  discard: t('Verwerfen')
}

/** Source and target folder of an op, as far as it has them (never mail content) */
export function opWhere(op: OpSummary): string | null {
  if (op.folderPath && op.targetFolderPath) return `${op.folderPath} → ${op.targetFolderPath}`
  return op.folderPath ?? op.targetFolderPath ?? null
}

/** "vor 3 Min." style age of the last change */
export function opAge(updatedAt: string, now: number): string {
  const ms = now - Date.parse(updatedAt)
  if (!Number.isFinite(ms) || ms < 60_000) return 'gerade eben'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return t('vor {{minutes}} Min.', { minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('vor {{hours}} Std.', { hours })
  const days = Math.floor(hours / 24)
  return days === 1 ? t('vor 1 Tag') : t('vor {{days}} Tagen', { days })
}

/** Discarding asks first where it may lose something: an unclear send, a pending change */
export function discardConfirm(entry: OpEntry): {
  title: string
  description: string
  confirmLabel: string
} {
  if (entry.attention === 'unclear') {
    return {
      title: t('Unklaren Versand verwerfen?'),
      description: t(
        'Bookingium prüft diese E-Mail dann nicht mehr. Sie ist vielleicht trotzdem beim Empfänger angekommen. Ein gespeicherter Entwurf bleibt im Ordner Entwürfe.'
      ),
      confirmLabel: t('Verwerfen')
    }
  }
  return {
    title: t('„{{opKindLabel}}“ verwerfen?', { opKindLabel: opKindLabel(entry.op.kind) }),
    description: t(
      'Die Änderung wird nicht mehr an den Server übertragen. Die Ansicht zeigt danach wieder den Stand des Servers.'
    ),
    confirmLabel: t('Verwerfen')
  }
}

/** The toast after "Prüfen" or "Erneut versuchen", from the core's outcome */
export function actionResult(
  action: 'resolve' | 'retry',
  outcome: OpResult['outcome']
): { ok: boolean; text: string } {
  if (action === 'resolve') {
    if (outcome === 'done')
      return { ok: true, text: t('Die E-Mail liegt im Ordner Gesendet; sie wurde verschickt.') }
    if (outcome === 'conflict') {
      return {
        ok: false,
        text: t('Nicht im Ordner Gesendet gefunden. Ob die E-Mail angekommen ist, bleibt unklar.')
      }
    }
    return { ok: false, text: t('Prüfen war gerade nicht möglich. Bitte später noch einmal.') }
  }
  if (outcome === 'done' || outcome === 'noop') return { ok: true, text: t('Erledigt') }
  if (outcome === 'conflict')
    return { ok: false, text: t('Der Server hat die Änderung erneut abgelehnt.') }
  if (outcome === 'unknown') return { ok: false, text: t('Das Ergebnis ist unklar.') }
  return { ok: false, text: t('Wieder fehlgeschlagen. Bookingium versucht es später erneut.') }
}
