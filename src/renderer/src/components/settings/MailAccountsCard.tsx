import { useState } from 'react'
import { CircleAlert, CircleCheck, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
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
import { connectionTestMessage, SECURITY_LABELS, SECURITY_PORTS } from '@/lib/mailConnection'
import type { MailAccountDto, MailAccountKind } from '../../../../main/mailclient/accounts'
import type { ConnectionTestResult } from '../../../../main/mailclient/core/connection_test'
import { allowsPlainLogin } from '../../../../main/mailclient/core/imap_options'
import type { ImapSecurity } from '../../../../main/mailclient/core/types'

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
  security: ImapSecurity
  user: string
  password: string
}

const EMPTY_DRAFT: Draft = {
  kind: 'production-readonly',
  email: '',
  host: '',
  port: '993',
  security: 'tls',
  user: '',
  password: ''
}

/** Result of "Verbindung testen", or of the test that runs before saving */
function TestResult({ result }: { result: ConnectionTestResult }) {
  if (result.ok) {
    return (
      <p
        className="flex gap-2 text-sm text-emerald-700 dark:text-emerald-400"
        role="status"
        data-testid="mail-account-test-result"
      >
        <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
        {connectionTestMessage(result)}
      </p>
    )
  }
  return (
    <div
      className="flex gap-2 text-sm text-destructive"
      role="alert"
      data-testid="mail-account-test-result"
    >
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p>{connectionTestMessage(result)}</p>
        {result.stage === 'other' && (
          <p className="break-words text-xs text-muted-foreground">{result.message}</p>
        )}
      </div>
    </div>
  )
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
  const [result, setResult] = useState<ConnectionTestResult | null>(null)
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
      setResult(null)
    }
  }

  const test = trpcReact.mail.accounts.test.useMutation({
    onSuccess: setResult,
    onError: (error) =>
      toast.error('Verbindungstest fehlgeschlagen', { description: error.message })
  })

  // The server checks the settings first and saves only what passes
  const save = trpcReact.mail.accounts.save.useMutation({
    onSuccess: (data) => {
      setResult(data.test)
      if (!data.account) return
      void utils.mail.invalidate()
      toast.success('E-Mail-Konto gespeichert')
      onOpenChange(false)
    },
    onError: (error) =>
      toast.error('Konto konnte nicht gespeichert werden', { description: error.message })
  })

  // Any change makes the last result stale
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setResult(null)
  }
  const port = Number(draft.port)
  // No login without encryption across a network
  const plainAllowed = draft.kind === 'sandbox' || allowsPlainLogin(draft.host)
  const securities: ImapSecurity[] = plainAllowed
    ? ['tls', 'starttls', 'none']
    : ['tls', 'starttls']
  const connectionValid =
    draft.host.trim() !== '' &&
    draft.user.trim() !== '' &&
    Number.isInteger(port) &&
    port > 0 &&
    port < 65536 &&
    securities.includes(draft.security) &&
    (account !== null || draft.password !== '')
  const valid = connectionValid && draft.email.trim() !== ''
  const busy = test.isLoading || save.isLoading
  // The local test server only makes sense on a developer machine
  const kinds: MailAccountKind[] =
    import.meta.env.DEV || account?.kind === 'sandbox'
      ? ['production-readonly', 'sandbox']
      : ['production-readonly']

  const changeKind = (kind: MailAccountKind) =>
    set(
      kind !== 'sandbox' && draft.security === 'none' && !allowsPlainLogin(draft.host)
        ? { kind, security: 'tls', port: String(SECURITY_PORTS.tls) }
        : { kind }
    )

  // Follow the usual port unless the user typed another one
  const changeSecurity = (security: ImapSecurity) =>
    set(
      draft.port === '' || draft.port === String(SECURITY_PORTS[draft.security])
        ? { security, port: String(SECURITY_PORTS[security]) }
        : { security }
    )

  const connection = () => ({
    id: account?.id,
    kind: draft.kind,
    host: draft.host.trim(),
    port,
    security: draft.security,
    user: draft.user.trim(),
    password: draft.password === '' ? undefined : draft.password
  })

  const runTest = () => {
    if (!connectionValid || busy) return
    setResult(null)
    test.mutate(connection())
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid || busy) return
    setResult(null)
    save.mutate({ ...connection(), email: draft.email.trim() })
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
                onValueChange={(kind) => changeKind(kind as MailAccountKind)}
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

          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div className="space-y-2">
              <Label htmlFor="mail-account-security">Verschlüsselung</Label>
              <Select
                value={draft.security}
                onValueChange={(security) => changeSecurity(security as ImapSecurity)}
              >
                <SelectTrigger id="mail-account-security">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {securities.map((security) => (
                    <SelectItem key={security} value={security}>
                      {SECURITY_LABELS[security]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

          {busy && (
            <p className="text-sm text-muted-foreground" role="status">
              Verbindung wird geprüft (höchstens 15 Sekunden)…
            </p>
          )}
          {result && !busy && <TestResult result={result} />}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={runTest}
              disabled={!connectionValid || busy}
            >
              {test.isLoading ? 'Wird geprüft…' : 'Verbindung testen'}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Abbrechen
              </Button>
              <Button type="submit" disabled={!valid || busy}>
                {save.isLoading ? 'Wird geprüft…' : 'Speichern'}
              </Button>
            </div>
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
                    {account.user} · {account.host}:{account.port} ·{' '}
                    {SECURITY_LABELS[account.security]}
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
