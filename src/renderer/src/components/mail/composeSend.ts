import type { OpSummary } from '../../../../main/mailclient/core/types'

/**
 * I2: where the editor stands with sending.
 *
 * - `idle`: editable, drafts are saved;
 * - `sending`: a send is in flight; no second send, no draft save (MR-04, MR-38);
 * - `unclear`: the server may have the mail. The editor is locked so it cannot be sent
 *   again by accident (MR-03); only "Prüfen" or an explicit "Als neue Mail senden" go on.
 */
export type SendPhase = 'idle' | 'sending' | 'unclear'

/** The core's wording for a send whose outcome it cannot know (core/index.ts sendMail) */
const UNCLEAR = /Versand unklar/

/** An unclear result must never read like a failure: "fehlgeschlagen" invites a resend */
export function isUnclearSend(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return UNCLEAR.test(message)
}

/**
 * Drafts are saved only while the editor is idle. A save during the send appends a draft
 * after the core removed the old one, an orphan in Entwürfe; after an unclear send it
 * would store a mail that may already be out (MR-38).
 */
export function draftSaveAllowed(phase: SendPhase): boolean {
  return phase === 'idle'
}

/**
 * The guard against a second send: Ctrl+Enter twice, or a key repeat, reaches send()
 * before React re-renders the disabled button, so the state alone cannot stop it (MR-04).
 * It is a plain object so a ref can hold it and the test can drive it.
 */
export function createSendGate(): {
  enter: () => boolean
  leave: () => void
  readonly busy: boolean
} {
  let busy = false
  return {
    enter: () => {
      if (busy) return false
      busy = true
      return true
    },
    leave: () => {
      busy = false
    },
    get busy() {
      return busy
    }
  }
}

/**
 * The journaled send this compose session started. The Message-ID is `<sendKey>@<domain>`
 * (core/compose.ts), so the key finds it without the renderer knowing the domain. The
 * newest wins if there are several.
 */
export function findSessionSend(ops: readonly OpSummary[], sendKey: string): OpSummary | undefined {
  const prefix = `${sendKey}@`
  return ops
    .filter((op) => op.kind === 'send' && op.messageId?.replace(/^</, '').startsWith(prefix))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
}

/**
 * What "Prüfen" does with that op: a `done` one was settled meanwhile (the startup replay
 * probes unclear sends), an unresolved one is probed, anything else is not ours to decide.
 */
export function unclearCheck(op: OpSummary | undefined): 'sent' | 'probe' | 'unknown' {
  if (!op) return 'unknown'
  if (op.state === 'done') return 'sent'
  if (op.state === 'unknown' || op.state === 'conflict') return 'probe'
  return 'unknown'
}

/**
 * What a recipient field does with a key. Enter must never fall through: inside the
 * editor's form an unhandled Enter is an implicit submit, and that used to send (MR-04).
 */
export type RecipientKeyAction = 'navigate' | 'pick' | 'commit' | 'swallow' | 'removeLast' | null

export function recipientKeyAction(
  key: string,
  {
    text,
    hasSuggestions,
    hasRecipients
  }: { text: string; hasSuggestions: boolean; hasRecipients: boolean }
): RecipientKeyAction {
  if (hasSuggestions && (key === 'ArrowDown' || key === 'ArrowUp')) return 'navigate'
  if (hasSuggestions && (key === 'Enter' || key === 'Tab')) return 'pick'
  if (key === 'Enter' || key === ',' || key === ';') {
    if (text.trim()) return 'commit'
    // an empty field: nothing to take, but the Enter is still ours. A comma or semicolon
    // in an empty field types nothing useful either, so it is swallowed the same way.
    return 'swallow'
  }
  if (key === 'Backspace' && !text && hasRecipients) return 'removeLast'
  return null
}
