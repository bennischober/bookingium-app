import { useState } from 'react'
import { FolderCog, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { confirmAction } from '@/lib/confirm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SECURITY_LABELS } from '@/lib/mailConnection'
import type { MailAccountDto } from '../../../../main/mailclient/accounts'
import { allowsPlainLogin } from '../../../../main/mailclient/core/imap_options'
import { MailAccountDialog } from '@/components/settings/MailAccountDialog'
import { MailFolderSyncDialog } from '@/components/settings/MailFolderSyncDialog'
import { t } from '../../../../main/i18n/translate'

/**
 * The badge in the list: read-only, refused by the write guard (stored with a cleartext login),
 * the local test server, or nothing for a normal account
 */
function accountBadge(account: MailAccountDto): string | null {
  if (account.readOnly) return t('Nur lesen')
  if (account.writeRefusal) return t('Schreiben gesperrt')
  return allowsPlainLogin(account.host) ? t('Test-Server (lokal)') : null
}

/** IMAP accounts for the built-in mail client */
export function MailAccountsCard() {
  const utils = trpcReact.useUtils()
  const accounts = trpcReact.mail.accounts.list.useQuery()
  // The worker reports start errors (e.g. a wrong password) through its status
  const status = trpcReact.mail.status.useQuery(undefined, { refetchInterval: 5000 })
  const [editing, setEditing] = useState<MailAccountDto | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  // #158: the account whose folder selection is open
  const [foldersOf, setFoldersOf] = useState<MailAccountDto | null>(null)

  const remove = trpcReact.mail.accounts.delete.useMutation({
    onSuccess: () => {
      void utils.mail.invalidate()
      toast.success(t('E-Mail-Konto entfernt'))
    },
    onError: (error) =>
      toast.error(t('Konto konnte nicht entfernt werden'), { description: error.message })
  })

  const openDialog = (account: MailAccountDto | null) => {
    setEditing(account)
    setDialogOpen(true)
  }

  const confirmRemove = async (account: MailAccountDto) => {
    const confirmed = await confirmAction({
      title: `${account.email} entfernen?`,
      description: t(
        'Entfernt die Zugangsdaten aus Bookingium. Das Postfach auf dem Server bleibt unverändert.'
      ),
      confirmLabel: t('Entfernen'),
      destructive: true
    })
    if (confirmed) remove.mutate({ id: account.id })
  }

  const list = accounts.data ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Postfächer')}</CardTitle>
        <CardDescription>
          {t(
            'IMAP-Konten für die E-Mail-Seite. Bookingium lädt die E-Mails herunter und durchsucht sie auf diesem Computer.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('Noch kein Postfach eingerichtet.')}</p>
        ) : (
          <ul className="divide-y rounded-md border" aria-label="E-Mail-Konten">
            {list.map((account) => (
              <li key={account.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{account.email}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {account.user} · {account.host}:{account.port} ·{' '}
                    {SECURITY_LABELS[account.security]}
                  </p>
                </div>
                {accountBadge(account) && (
                  <Badge
                    variant={account.readOnly || account.writeRefusal ? 'secondary' : 'outline'}
                    title={account.writeRefusal ?? undefined}
                  >
                    {(account.readOnly || account.writeRefusal) && (
                      <Lock className="mr-1 h-3 w-3" />
                    )}
                    {accountBadge(account)}
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setFoldersOf(account)}
                  title={t('Ordner auswählen')}
                  aria-label={t('Ordner von {{email}} auswählen', { email: account.email })}
                >
                  <FolderCog />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => openDialog(account)}
                  title={t('Bearbeiten')}
                  aria-label={`${account.email} bearbeiten`}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void confirmRemove(account)}
                  title={t('Entfernen')}
                  aria-label={`${account.email} entfernen`}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {list.length > 0 && status.data?.error && (
          <p className="text-sm text-destructive" role="alert">
            {status.data.error}
          </p>
        )}

        <Button variant="outline" onClick={() => openDialog(null)}>
          <Plus className="h-4 w-4" /> {t('Postfach hinzufügen…')}
        </Button>
      </CardContent>

      <MailAccountDialog account={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
      {foldersOf && (
        <MailFolderSyncDialog
          accountId={foldersOf.id}
          email={foldersOf.email}
          open
          onOpenChange={(open) => !open && setFoldersOf(null)}
        />
      )}
    </Card>
  )
}
