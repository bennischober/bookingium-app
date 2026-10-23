import { useState } from 'react'
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { confirmAction } from '@/lib/confirm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { MailAccountDto, MailAccountKind } from '../../../../main/mailclient/accounts'

const KIND_LABELS: Record<MailAccountKind, string> = {
  'production-readonly': 'Nur lesen',
  sandbox: 'Test-Server (lokal)'
}

type Draft = {
  id?: string
  kind: MailAccountKind
  email: string
  host: string
  port: string
  user: string
  password: string
}

const EMPTY_DRAFT: Draft = {
  kind: 'production-readonly',
  email: '',
  host: '',
  port: '993',
  user: '',
  password: ''
}

/** Add or edit one account; the stored password is never shown again */
function MailAccountDialog({
  account,
  open,
  onOpenChange
}: {
  account: MailAccountDto | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const utils = trpcReact.useUtils()
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [lastOpen, setLastOpen] = useState(false)
  // Reset the form each time the dialog opens (state adjustment during render)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setDraft(
        account
          ? { ...account, port: String(account.port), password: '' }
          : { ...EMPTY_DRAFT, kind: 'production-readonly' }
      )
    }
  }

  const save = trpcReact.mail.accounts.save.useMutation({
    onSuccess: () => {
      void utils.mail.invalidate()
      toast.success('E-Mail-Konto gespeichert')
      onOpenChange(false)
    },
    onError: (error) =>
      toast.error('Konto konnte nicht gespeichert werden', { description: error.message })
  })

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const port = Number(draft.port)
  const valid =
    draft.email.trim() !== '' &&
    draft.host.trim() !== '' &&
    draft.user.trim() !== '' &&
    Number.isInteger(port) &&
    port > 0 &&
    port < 65536 &&
    (account !== null || draft.password !== '')
  // The local test server only makes sense on a developer machine
  const kinds: MailAccountKind[] =
    import.meta.env.DEV || account?.kind === 'sandbox'
      ? ['production-readonly', 'sandbox']
      : ['production-readonly']

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid) return
    save.mutate({
      id: account?.id,
      kind: draft.kind,
      email: draft.email.trim(),
      host: draft.host.trim(),
      port,
      user: draft.user.trim(),
      password: draft.password === '' ? undefined : draft.password
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {account ? 'E-Mail-Konto bearbeiten' : 'E-Mail-Konto hinzufügen'}
            </DialogTitle>
            <DialogDescription>
              IMAP-Zugang des Postfachs. Das Passwort wird mit der Verschlüsselung von Windows
              gespeichert.
            </DialogDescription>
          </DialogHeader>

          {kinds.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="mail-account-kind">Art</Label>
              <Select
                value={draft.kind}
                onValueChange={(kind) => set({ kind: kind as MailAccountKind })}
              >
                <SelectTrigger id="mail-account-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kinds.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {KIND_LABELS[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="mail-account-email">E-Mail-Adresse</Label>
            <Input
              id="mail-account-email"
              type="email"
              value={draft.email}
              onChange={(e) =>
                set({
                  email: e.target.value,
                  // The login is usually the address; follow it until edited
                  user: draft.user === draft.email ? e.target.value : draft.user
                })
              }
              autoFocus
            />
          </div>

          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div className="space-y-2">
              <Label htmlFor="mail-account-host">IMAP-Server</Label>
              <Input
                id="mail-account-host"
                value={draft.host}
                onChange={(e) => set({ host: e.target.value })}
                placeholder="imap.ionos.de"
                spellCheck={false}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mail-account-port">Port</Label>
              <Input
                id="mail-account-port"
                inputMode="numeric"
                value={draft.port}
                onChange={(e) => set({ port: e.target.value.replace(/\D/g, '') })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mail-account-user">Benutzername</Label>
            <Input
              id="mail-account-user"
              value={draft.user}
              onChange={(e) => set({ user: e.target.value })}
              spellCheck={false}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mail-account-password">Passwort</Label>
            <Input
              id="mail-account-password"
              type="password"
              value={draft.password}
              onChange={(e) => set({ password: e.target.value })}
              placeholder={account ? 'Unverändert lassen' : undefined}
              autoComplete="off"
            />
          </div>

          {draft.kind === 'production-readonly' && (
            <p className="flex gap-2 text-xs text-muted-foreground">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Bookingium liest das Postfach nur: Es verschiebt, markiert und löscht nichts und
              sendet keine E-Mails.
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={!valid || save.isLoading}>
              {save.isLoading ? 'Wird gespeichert…' : 'Speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** IMAP accounts for the built-in mail client */
export function MailAccountsCard() {
  const utils = trpcReact.useUtils()
  const accounts = trpcReact.mail.accounts.list.useQuery()
  // The worker reports start errors (e.g. a wrong password) through its status
  const status = trpcReact.mail.status.useQuery(undefined, { refetchInterval: 5000 })
  const [editing, setEditing] = useState<MailAccountDto | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const remove = trpcReact.mail.accounts.delete.useMutation({
    onSuccess: () => {
      void utils.mail.invalidate()
      toast.success('E-Mail-Konto entfernt')
    },
    onError: (error) =>
      toast.error('Konto konnte nicht entfernt werden', { description: error.message })
  })

  const openDialog = (account: MailAccountDto | null) => {
    setEditing(account)
    setDialogOpen(true)
  }

  const confirmRemove = async (account: MailAccountDto) => {
    const confirmed = await confirmAction({
      title: `${account.email} entfernen?`,
      description:
        'Entfernt die Zugangsdaten aus Bookingium. Das Postfach auf dem Server bleibt unverändert.',
      confirmLabel: 'Entfernen',
      destructive: true
    })
    if (confirmed) remove.mutate({ id: account.id })
  }

  const list = accounts.data ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Postfächer</CardTitle>
        <CardDescription>
          IMAP-Konten für die E-Mail-Seite. Bookingium lädt die E-Mails herunter und durchsucht sie
          auf diesem Computer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch kein Postfach eingerichtet.</p>
        ) : (
          <ul className="divide-y rounded-md border" aria-label="E-Mail-Konten">
            {list.map((account) => (
              <li key={account.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{account.email}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {account.user} · {account.host}:{account.port}
                  </p>
                </div>
                <Badge variant={account.kind === 'sandbox' ? 'outline' : 'secondary'}>
                  {account.kind === 'production-readonly' && <Lock className="mr-1 h-3 w-3" />}
                  {KIND_LABELS[account.kind]}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => openDialog(account)}
                  title="Bearbeiten"
                  aria-label={`${account.email} bearbeiten`}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void confirmRemove(account)}
                  title="Entfernen"
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
          <Plus className="h-4 w-4" /> Postfach hinzufügen…
        </Button>
      </CardContent>

      <MailAccountDialog account={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
    </Card>
  )
}
