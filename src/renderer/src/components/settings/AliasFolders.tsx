import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CircleCheck, FolderPlus } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { mailApi } from '@/lib/mailApi'
import { Button } from '@/components/ui/button'
import { flattenFolders, isInbox } from '@/components/mail/format'
import type { MailRuleDto } from '../../../../main/api/schemas/mailRule.schema'
import { aliasFolderName, aliasRule, aliasRuleOf } from './aliasFolderRules'
import { t } from '../../../../main/i18n/translate'

/**
 * #213: the forwarded addresses of each writable account ("Weitere eigene Adressen"), each with
 * its folder: either the rule that already moves its mail, or a button that creates a folder named
 * after the address and that rule. Only new mail is moved, like every rule.
 */
export function AliasFolders({ rules }: { rules: MailRuleDto[] }) {
  const utils = trpcReact.useUtils()
  const queryClient = useQueryClient()
  const accounts = trpcReact.mail.accounts.list.useQuery()
  const status = trpcReact.mail.status.useQuery()
  const saveRule = trpcReact.mailRule.save.useMutation()
  const [busy, setBusy] = useState<string | null>(null)

  const withAliases = (accounts.data ?? []).filter(
    (account) => account.aliases.length > 0 && !account.readOnly && !account.writeRefusal
  )
  if (withAliases.length === 0) return null

  const create = async (accountId: string, alias: string) => {
    setBusy(`${accountId}:${alias}`)
    try {
      const folders = flattenFolders(await mailApi.getFolders(accountId))
      const delimiter = folders.find(isInbox)?.delimiter ?? '/'
      const name = aliasFolderName(alias, delimiter)
      // A folder of that name from an earlier try is taken as it is
      let path = folders.find((f) => f.path === name)?.path ?? null
      if (path === null) {
        const op = await mailApi.createFolder(null, name, accountId)
        if (op.state !== 'done' || !op.folderPath) {
          throw new Error(op.error ?? t('Der Ordner wurde auf dem Server nicht angelegt.'))
        }
        path = op.folderPath
        void queryClient.invalidateQueries({ queryKey: ['mail', accountId, 'folders'] })
      }
      await saveRule.mutateAsync(aliasRule(accountId, alias, path))
      await utils.mailRule.list.invalidate()
      toast.success(t('Ordner und Regel angelegt'), {
        description: t('Neue Mails an diese Adresse landen ab jetzt in ihrem Ordner.')
      })
    } catch (error) {
      toast.error(t('Ordner oder Regel konnte nicht angelegt werden'), {
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setBusy(null)
    }
  }

  const running = status.data?.running === true
  return (
    <section className="space-y-2" aria-label={t('Weitergeleitete Adressen')}>
      <h3 className="text-sm font-medium">{t('Weitergeleitete Adressen')}</h3>
      <p className="text-xs text-muted-foreground">
        {t(
          'Je Adresse ein eigener Ordner: legt den Ordner auf dem Server an und eine Regel, die neue Mails an diese Adresse dorthin verschiebt. Schon vorhandene Mails bleiben, wo sie sind.'
        )}
      </p>
      <ul className="divide-y rounded-md border">
        {withAliases.flatMap((account) =>
          account.aliases.map((alias) => {
            const rule = aliasRuleOf(rules, account.id, alias)
            const key = `${account.id}:${alias}`
            return (
              <li key={key} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {alias}
                  {withAliases.length > 1 && (
                    <span className="text-muted-foreground"> · {account.email}</span>
                  )}
                </span>
                {rule ? (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <CircleCheck className="h-4 w-4 text-green-600" aria-hidden />
                    {t('Ordner')} {rule.moveToFolderPath}
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!running || busy !== null}
                    title={running ? undefined : t('Der Mail-Abruf läuft nicht')}
                    onClick={() => void create(account.id, alias)}
                  >
                    <FolderPlus className="h-4 w-4" />
                    {busy === key ? t('Wird angelegt…') : t('Ordner und Regel anlegen')}
                  </Button>
                )}
              </li>
            )
          })
        )}
      </ul>
    </section>
  )
}
