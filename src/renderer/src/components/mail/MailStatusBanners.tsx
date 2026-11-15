import type { UseQueryResult } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { mailApi } from '@/lib/mailApi'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { SyncStatus } from '../../../../main/mailclient/core/types'

/**
 * The notes under the mail page's top bar: the mail service down or starting, a rejected login and
 * the low-space warning
 */
export function MailStatusBanners({
  worker,
  loginFailed,
  syncStatus,
  accountId
}: {
  worker: { running: boolean; starting: boolean; error: string | null } | undefined
  loginFailed: boolean
  syncStatus: UseQueryResult<SyncStatus>
  accountId: string
}) {
  const navigate = useNavigate()
  return (
    <>
      {worker?.error && (
        <p role="alert" className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
          Der E-Mail-Dienst läuft nicht: {worker.error}
        </p>
      )}
      {worker?.starting && (
        <p
          role="status"
          className="flex items-center gap-2 border-b bg-muted px-4 py-2 text-sm text-muted-foreground"
        >
          <Spinner className="size-4" />
          Der E-Mail-Dienst startet. Nach einem Update kann das bei einem großen Postfach einige
          Minuten dauern.
        </p>
      )}

      {loginFailed && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive"
          data-testid="mail-login-failed"
        >
          <p className="min-w-0 flex-1">
            Anmeldung fehlgeschlagen: Der Server hat Benutzername oder Passwort abgelehnt.
            Bookingium versucht es erst wieder, wenn das Konto neu gespeichert wird.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void navigate({ to: '/settings', search: { tab: 'email' } })}
          >
            Zugangsdaten prüfen
          </Button>
        </div>
      )}

      {syncStatus.data?.spaceWarning && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-300"
          data-testid="mail-space-banner"
        >
          <p className="min-w-0 flex-1">
            {syncStatus.data.spaceWarning} E-Mails über 5 MB lädt Bookingium erst beim Öffnen, meist
            wird es also weniger.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void mailApi.resumeSync(accountId).then(() => syncStatus.refetch())}
          >
            Trotzdem fortsetzen
          </Button>
        </div>
      )}
    </>
  )
}
