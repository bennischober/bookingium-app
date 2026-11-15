import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { ComposeBusy } from './ComposeToolbar'

/** I2: the send may have reached the server; the user checks Sent or sends it again on purpose */
export function ComposeUnclearBanner({
  busy,
  checkUnclear,
  sendAsNew,
  close
}: {
  busy: ComposeBusy
  checkUnclear: () => Promise<void>
  sendAsNew: () => Promise<void>
  close: () => void
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
      data-testid="send-unclear"
    >
      <span className="mr-auto">
        Versand unklar: Die E-Mail ist vielleicht schon beim Server angekommen. Bitte prüfen, bevor
        sie noch einmal gesendet wird.
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy !== null}
        onClick={() => void checkUnclear()}
      >
        {busy === 'send' && <Spinner className="size-4" />}
        Im Ordner Gesendet prüfen
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={busy !== null}
        onClick={() => void sendAsNew()}
      >
        Als neue Mail senden
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={close}>
        Schließen
      </Button>
    </div>
  )
}
