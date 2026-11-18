import type { AppSettings } from '../api/schemas/settings.schema'
import { listMailAccounts, type MailAccountDto } from '../mailclient/accounts'
import { invoiceSendAccount } from './invoiceSend'

/**
 * I7 (MR-12): the account invoices, contracts and receipts go out from, chosen in the
 * settings; checked before anything is written or opened. #136: bookingum's own editor is the
 * only way they are sent, so without an account there is nothing to open. `setup`: the
 * renderer offers Einstellungen › E-Mail.
 */
export function documentSender(
  settings: AppSettings
): { account: MailAccountDto } | { error: string; setup: true } {
  const accounts = listMailAccounts()
  if (accounts.length === 0) {
    return { error: 'Zum Senden zuerst ein E-Mail-Konto hinzufügen.', setup: true }
  }
  const sender = invoiceSendAccount(settings.invoiceMailAccountId, accounts)
  return 'error' in sender ? { ...sender, setup: true } : sender
}
