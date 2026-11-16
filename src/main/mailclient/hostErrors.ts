// The worker's start-up failures in the words the user reads. The mail core is dependency-free
// and English on purpose; its messages are translated here, at the host, before they reach a
// toast. Pure, so it is unit tested.

const NO_ACCOUNT_OPENED = /no mail account could be opened/i

/**
 * The text of a failed worker start. "No account could be opened" happens right after an
 * account was saved (the worker is still starting) or when its data folder is unreadable.
 */
export function initErrorText(message: string): string {
  if (NO_ACCOUNT_OPENED.test(message)) {
    return 'Das E-Mail-Konto ist noch nicht bereit. Bitte gleich noch einmal versuchen – bleibt es dabei, das Konto unter Einstellungen › E-Mail prüfen.'
  }
  return message
}
