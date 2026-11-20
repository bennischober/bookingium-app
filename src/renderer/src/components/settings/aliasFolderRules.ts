/**
 * #213: a folder per forwarded address (the account's aliases), in a pure module so vitest can hold
 * it. One click creates a folder named after the address and a mail rule (#124) that moves new
 * mail sent to that address into it. Nothing happens on its own: creating folders on the server is
 * the user's call, and a rule can be changed or removed like any other.
 */
import type { MailRuleDto, SaveMailRuleInput } from '../../../../main/api/schemas/mailRule.schema'
import { ruleAlternatives } from '../../../../main/api/schemas/mailRule.schema'
import { t } from '../../../../main/i18n/translate'

/**
 * The folder name for an alias: the address itself, with the server's hierarchy delimiter replaced
 * (on a server that separates folders with "." the address would otherwise become nested folders)
 */
export function aliasFolderName(alias: string, delimiter: string): string {
  const name = alias.trim().toLowerCase()
  return delimiter ? name.split(delimiter).join('-') : name
}

/** The rule of an alias, if one already moves its mail: a rule of the account that names it under "An/Cc" and has a folder */
export function aliasRuleOf(
  rules: MailRuleDto[],
  accountId: string,
  alias: string
): MailRuleDto | undefined {
  const address = alias.trim().toLowerCase()
  return rules.find(
    (rule) =>
      rule.accountId === accountId &&
      rule.moveToFolderPath !== null &&
      ruleAlternatives(rule.matchTo).some((value) => value.toLowerCase() === address)
  )
}

/** The rule behind "Ordner und Regel anlegen": new mail to the alias goes into its folder */
export function aliasRule(accountId: string, alias: string, folderPath: string): SaveMailRuleInput {
  const address = alias.trim().toLowerCase()
  return {
    accountId,
    name: t('Weiterleitung: {{address}}', { address }),
    enabled: true,
    matchFrom: '',
    matchTo: address,
    matchSubject: '',
    moveToFolderPath: folderPath,
    markRead: false,
    markFlagged: false,
    link: null
  }
}
