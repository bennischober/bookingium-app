import { useState } from 'react'
import { CircleAlert, CircleCheck, Eye, EyeOff, Lock } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  capabilitiesLine,
  connectionTestMessage,
  parseAliases,
  SECURITY_LABELS,
  SECURITY_PORTS
} from '@/lib/mailConnection'
import type { MailAccountDto } from '../../../../main/mailclient/accounts'
import type { ConnectionTestResult } from '../../../../main/mailclient/core/connection_test'
import { allowsPlainLogin } from '../../../../main/mailclient/core/imap_options'
import type { ImapSecurity } from '../../../../main/mailclient/core/types'
import { t } from '../../../../main/i18n/translate'

type Draft = {
  id?: string
  /** "Nur lesen": Bookingium writes nothing to this mailbox */
  readOnly: boolean
  email: string
  host: string
  port: string
  security: ImapSecurity
  user: string
  password: string
  signature: string
  /** #211: the sender name; '' = the bare address */
  displayName: string
  /** The user's further own addresses, as typed (comma or line separated) */
  aliases: string
  /** A7: this account's own SMTP endpoint; empty = the IMAP host on 1025 */
  smtpHost: string
  smtpPort: string
  /** A7: the SMTP encryption; empty = the IMAP security */
  smtpSecurity: ImapSecurity | ''
}

const EMPTY_DRAFT: Draft = {
  readOnly: false,
  email: '',
  host: '',
  port: '993',
  security: 'tls',
  user: '',
  password: '',
  signature: '',
  displayName: '',
  aliases: '',
  smtpHost: '',
  smtpPort: '',
  smtpSecurity: ''
}

/** Result of "Verbindung testen", or of the test that runs before saving */
function TestResult({ result }: { result: ConnectionTestResult }) {
  if (result.ok) {
    const capabilities = capabilitiesLine(result)
    return (
      <div
        className="flex gap-2 text-sm text-emerald-700 dark:text-emerald-400"
        role="status"
        data-testid="mail-account-test-result"
      >
        <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <p>{connectionTestMessage(result)}</p>
          {/* #156: what the server offers (LIST-STATUS, CONDSTORE, …), names only */}
          {capabilities && (
            <p
              className="break-words text-xs text-muted-foreground"
              data-testid="mail-account-test-capabilities"
            >
              {capabilities}
            </p>
          )}
        </div>
      </div>
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
export function MailAccountDialog({
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
  // #210: what is typed into the password field can be shown; hidden again on every open
  const [showPassword, setShowPassword] = useState(false)
  const [lastOpen, setLastOpen] = useState(false)
  // Reset the form each time the dialog opens (state adjustment during render)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setDraft(
        account
          ? {
              ...account,
              port: String(account.port),
              password: '',
              signature: account.signature ?? '',
              displayName: account.displayName ?? '',
              aliases: account.aliases.join(', '),
              smtpHost: account.smtpHost,
              smtpPort: String(account.smtpPort),
              smtpSecurity: account.smtpSecurity
            }
          : EMPTY_DRAFT
      )
      setResult(null)
      setShowPassword(false)
    }
  }

  const test = trpcReact.mail.accounts.test.useMutation({
    onSuccess: setResult,
    onError: (error) =>
      toast.error(t('Verbindungstest fehlgeschlagen'), { description: error.message })
  })

  // The server checks the settings first and saves only what passes
  const save = trpcReact.mail.accounts.save.useMutation({
    onSuccess: (data) => {
      setResult(data.test)
      if (!data.account) return
      void utils.mail.invalidate()
      toast.success(t('E-Mail-Konto gespeichert'))
      onOpenChange(false)
    },
    onError: (error) =>
      toast.error(t('Konto konnte nicht gespeichert werden'), { description: error.message })
  })

  // Any change makes the last result stale
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setResult(null)
  }
  const port = Number(draft.port)
  // No login without encryption across a network. Host-based, exactly like the
  // main process's check: only the local test server may log in without one.
  const plainAllowed = allowsPlainLogin(draft.host)
  const securities: ImapSecurity[] = plainAllowed
    ? ['tls', 'starttls', 'none']
    : ['tls', 'starttls']
  // I6 (MR-20): the SMTP login is judged by its own host, like the main process does
  const smtpSecurities: ImapSecurity[] = allowsPlainLogin(draft.smtpHost.trim() || draft.host)
    ? ['tls', 'starttls', 'none']
    : ['tls', 'starttls']
  const connectionValid =
    draft.host.trim() !== '' &&
    draft.user.trim() !== '' &&
    Number.isInteger(port) &&
    port > 0 &&
    port < 65536 &&
    securities.includes(draft.security) &&
    (draft.smtpSecurity === '' || smtpSecurities.includes(draft.smtpSecurity)) &&
    (account !== null || draft.password !== '')
  const aliases = parseAliases(draft.aliases)
  const valid = connectionValid && draft.email.trim() !== '' && aliases.invalid === null
  const busy = test.isLoading || save.isLoading
  // Follow the usual port unless the user typed another one
  const changeSecurity = (security: ImapSecurity) =>
    set(
      draft.port === '' || draft.port === String(SECURITY_PORTS[draft.security])
        ? { security, port: String(SECURITY_PORTS[security]) }
        : { security }
    )

  const connection = () => ({
    id: account?.id,
    readOnly: draft.readOnly,
    host: draft.host.trim(),
    port,
    security: draft.security,
    user: draft.user.trim(),
    password: draft.password === '' ? undefined : draft.password,
    // A7: blank falls back to the IMAP host on the default port
    smtpHost: draft.smtpHost.trim() || undefined,
    smtpPort: Number(draft.smtpPort) > 0 ? Number(draft.smtpPort) : undefined,
    // A7: blank falls back to the IMAP encryption
    smtpSecurity: draft.smtpSecurity === '' ? undefined : draft.smtpSecurity
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
    save.mutate({
      ...connection(),
      email: draft.email.trim(),
      signature: draft.signature.trim() || undefined,
      // '' clears a stored name (unlike undefined, which keeps it)
      displayName: draft.displayName.trim(),
      aliases: aliases.aliases
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* The form scrolls: a small window must still reach the buttons at the bottom */}
        <form onSubmit={submit} className="max-h-[70vh] space-y-4 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {account ? t('E-Mail-Konto bearbeiten') : t('E-Mail-Konto hinzufügen')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'IMAP-Zugang des Postfachs. Das Passwort wird mit der Verschlüsselung von Windows gespeichert.'
              )}
            </DialogDescription>
          </DialogHeader>

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
            <Label htmlFor="mail-account-display-name">{t('Anzeigename')}</Label>
            <Input
              id="mail-account-display-name"
              value={draft.displayName}
              onChange={(e) => set({ displayName: e.target.value })}
              placeholder={t('z. B. Max Muster | Agentur')}
              maxLength={100}
            />
            <p className="text-xs text-muted-foreground">
              {t(
                'Steht als Absender vor der Adresse in jeder Mail aus diesem Postfach (auch Rechnungen, Verträge und DATEV). Leer: nur die Adresse.'
              )}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mail-account-aliases">{t('Weitere eigene Adressen')}</Label>
            <Input
              id="mail-account-aliases"
              value={draft.aliases}
              onChange={(e) => set({ aliases: e.target.value })}
              placeholder={t('z. B. info@… – durch Komma getrennt')}
              aria-describedby="mail-account-aliases-hint"
            />
            <p id="mail-account-aliases-hint" className="text-xs text-muted-foreground">
              {aliases.invalid
                ? t('„{{invalid}}“ ist keine E-Mail-Adresse.', { invalid: aliases.invalid })
                : t(
                    'Adressen, die in dieses Postfach weiterleiten. Mails über sie werden keinem Kontakt zugeordnet.'
                  )}
            </p>
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
              <Label htmlFor="mail-account-security">{t('Verschlüsselung')}</Label>
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
              <Label htmlFor="mail-account-port">{t('Port')}</Label>
              <Input
                id="mail-account-port"
                inputMode="numeric"
                value={draft.port}
                onChange={(e) => set({ port: e.target.value.replace(/\D/g, '') })}
              />
            </div>
          </div>

          {/* A7: the SMTP endpoint is its own setting - sending is a write to
              another server. Blank means "the IMAP host, port 1025". */}
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div className="space-y-2">
              <Label htmlFor="mail-account-smtp-host">SMTP-Server</Label>
              <Input
                id="mail-account-smtp-host"
                value={draft.smtpHost}
                onChange={(e) => set({ smtpHost: e.target.value })}
                placeholder={draft.host || 'smtp.ionos.de'}
                spellCheck={false}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mail-account-smtp-port">SMTP-Port</Label>
              <Input
                id="mail-account-smtp-port"
                inputMode="numeric"
                value={draft.smtpPort}
                onChange={(e) => set({ smtpPort: e.target.value.replace(/\D/g, '') })}
                placeholder="1025"
              />
            </div>
          </div>

          {/* A7: the SMTP encryption is its own setting. A real mailbox is often
              IMAPS 993 plus submission 587 with STARTTLS, so it cannot borrow the
              IMAP value; "wie IMAP" keeps them equal. */}
          <div className="space-y-2">
            <Label htmlFor="mail-account-smtp-security">{t('SMTP-Verschlüsselung')}</Label>
            <Select
              value={draft.smtpSecurity === '' ? 'imap' : draft.smtpSecurity}
              onValueChange={(value) =>
                set({ smtpSecurity: value === 'imap' ? '' : (value as ImapSecurity) })
              }
            >
              <SelectTrigger id="mail-account-smtp-security">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="imap">{t('Wie IMAP')}</SelectItem>
                {smtpSecurities.map((security) => (
                  <SelectItem key={security} value={security}>
                    {SECURITY_LABELS[security]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mail-account-user">{t('Benutzername')}</Label>
            <Input
              id="mail-account-user"
              value={draft.user}
              onChange={(e) => set({ user: e.target.value })}
              spellCheck={false}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mail-account-password">{t('Passwort')}</Label>
            <div className="relative">
              <Input
                id="mail-account-password"
                type={showPassword ? 'text' : 'password'}
                value={draft.password}
                onChange={(e) => set({ password: e.target.value })}
                placeholder={account ? t('Unverändert lassen') : undefined}
                autoComplete="off"
                spellCheck={false}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full w-10 text-muted-foreground hover:bg-transparent"
                aria-label={showPassword ? t('Passwort verbergen') : t('Passwort anzeigen')}
                aria-pressed={showPassword}
                title={showPassword ? t('Passwort verbergen') : t('Passwort anzeigen')}
                onClick={() => setShowPassword((shown) => !shown)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                'Zeigt nur, was hier eingetippt wird; das gespeicherte Passwort wird nie wieder angezeigt.'
              )}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mail-account-signature">{t('Signatur')}</Label>
            <Textarea
              id="mail-account-signature"
              value={draft.signature}
              onChange={(e) => set({ signature: e.target.value })}
              placeholder={t('Name, Telefon, … – wird an neue Mails angehängt')}
              rows={3}
            />
          </div>

          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                id="mail-account-read-only"
                type="checkbox"
                checked={draft.readOnly}
                onChange={(e) => set({ readOnly: e.target.checked })}
                aria-describedby="mail-account-read-only-hint"
              />
              {t('Nur lesen')}
            </label>
            <p
              id="mail-account-read-only-hint"
              className="flex gap-2 text-xs text-muted-foreground"
            >
              {draft.readOnly && <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              {draft.readOnly
                ? t(
                    'Bookingium liest das Postfach nur: Es verschiebt, markiert und löscht nichts und sendet keine E-Mails.'
                  )
                : t(
                    'Bookingium kann E-Mails markieren, verschieben, löschen und über den SMTP-Server senden.'
                  )}
            </p>
          </div>

          {busy && (
            <p className="text-sm text-muted-foreground" role="status">
              {t('Verbindung wird geprüft (höchstens 15 Sekunden)…')}
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
              {test.isLoading ? t('Wird geprüft…') : t('Verbindung testen')}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t('Abbrechen')}
              </Button>
              <Button type="submit" disabled={!valid || busy}>
                {save.isLoading ? t('Wird geprüft…') : t('Speichern')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
