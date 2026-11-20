import { Sparkles } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { setTipState } from '@/lib/tips'
import { whatsNewFor } from '@/lib/whatsNew'
import { useTipState } from '@/hooks/useTipState'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { t } from '../../../main/i18n/translate'

/**
 * #253: after an update, the new version's highlights once per computer. Only in the installed
 * app (updates supported): a dev build or an e2e run never shows it.
 */
export function WhatsNewHost() {
  const status = trpcReact.updates.status.useQuery(undefined, { staleTime: Infinity })
  const tips = useTipState()
  const version = status.data?.currentVersion
  const installed = status.data !== undefined && status.data.phase !== 'unsupported'
  const items = version ? whatsNewFor(version, tips.lastSeenVersion) : []

  // Open until closed: closing stores the version, which empties the list
  if (!installed || !version || items.length === 0) return null

  const close = () => {
    setTipState((current) => ({ ...current, lastSeenVersion: version }))
  }

  return (
    <Dialog open onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            {t('Neu in Bookingium')} {version}
          </DialogTitle>
          <DialogDescription>{t('Was sich mit dem Update geändert hat.')}</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={close}>{t('Verstanden')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
