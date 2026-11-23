import { useState } from 'react'
import { Lock, LockOpen, UserRound } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { useStaffAccess } from '@/hooks/useStaffAccess'
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
import { staffPinProblem } from './staffPin'
import type { AccessStatusDto } from '../../../../main/api/schemas/access.schema'
import { t } from '../../../../main/i18n/translate'

type PinDialog = 'enable' | 'change' | null

const showError = (error: { message: string }) =>
  toast.error(t('Mitarbeiterzugang'), { description: error.message })

/**
 * #262 "Mitarbeiterzugang" (Einstellungen › Allgemein): switches this computer to staff access,
 * which locks the company-internal areas, optionally behind a PIN. Locked, the card is where
 * they are unlocked again for this session.
 */
export function StaffAccessCard() {
  const utils = trpcReact.useUtils()
  const { status } = useStaffAccess()
  const [pinDialog, setPinDialog] = useState<PinDialog>(null)
  const [pin, setPin] = useState('')

  const apply = (next: AccessStatusDto) => utils.access.status.setData(undefined, next)

  const unlock = trpcReact.access.unlock.useMutation({
    onSuccess: (next) => {
      apply(next)
      setPin('')
    },
    onError: showError
  })
  const lock = trpcReact.access.lock.useMutation({ onSuccess: apply, onError: showError })
  const disable = trpcReact.access.disable.useMutation({
    onSuccess: (next) => {
      apply(next)
      toast.success(t('Mitarbeiterzugang ausgeschaltet'))
    },
    onError: showError
  })
  const removePin = trpcReact.access.setPin.useMutation({
    onSuccess: (next) => {
      apply(next)
      toast.success(t('PIN entfernt'))
    },
    onError: showError
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="h-4 w-4" />
          {t('Mitarbeiterzugang')}
        </CardTitle>
        <CardDescription>
          {t(
            'Sperrt auf diesem Computer die firmeninternen Bereiche: DATEV-Übergabe, eigene Firma und Rechnungseinstellungen, Import von Listen, Sicherung und Wiederherstellung sowie die Einrichtung des Abgleichs. Gilt nur auf diesem Computer.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!status ? (
          <p className="text-sm text-muted-foreground">{t('Wird geladen…')}</p>
        ) : !status.staffMode ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {t('Aus: Auf diesem Computer ist alles zugänglich.')}
            </p>
            <Button variant="outline" onClick={() => setPinDialog('enable')}>
              <Lock className="h-4 w-4" /> {t('Mitarbeiterzugang einschalten…')}
            </Button>
          </div>
        ) : status.locked ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              if (!unlock.isPending) unlock.mutate({ pin })
            }}
          >
            <p className="text-sm">
              <Lock className="mr-1 inline h-4 w-4 align-text-bottom" />
              {t('Eingeschaltet: Die firmeninternen Bereiche sind gesperrt.')}
            </p>
            <div className="flex flex-wrap items-end gap-3">
              {status.hasPin && (
                <div className="space-y-1">
                  <Label htmlFor="staff-unlock-pin">{t('PIN')}</Label>
                  <Input
                    id="staff-unlock-pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    className="w-40"
                    value={pin}
                    onChange={(event) => setPin(event.target.value)}
                  />
                </div>
              )}
              <Button
                type="submit"
                variant="outline"
                disabled={unlock.isPending || (status.hasPin && pin === '')}
              >
                <LockOpen className="h-4 w-4" /> {t('Entsperren')}
              </Button>
            </div>
            {!status.hasPin && (
              <p className="text-xs text-muted-foreground">
                {t('Ohne PIN kann jeder an diesem Computer die Bereiche entsperren.')}
              </p>
            )}
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              <LockOpen className="mr-1 inline h-4 w-4 align-text-bottom" />
              {t('Entsperrt, bis Sie wieder sperren oder Bookingium beenden.')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => lock.mutate()} disabled={lock.isPending}>
                <Lock className="h-4 w-4" /> {t('Wieder sperren')}
              </Button>
              <Button variant="outline" onClick={() => setPinDialog('change')}>
                {status.hasPin ? t('PIN ändern…') : t('PIN festlegen…')}
              </Button>
              {status.hasPin && (
                <Button
                  variant="outline"
                  onClick={() => removePin.mutate({ pin: null })}
                  disabled={removePin.isPending}
                >
                  {t('PIN entfernen')}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => disable.mutate()}
                disabled={disable.isPending}
              >
                {t('Mitarbeiterzugang ausschalten')}
              </Button>
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {t(
            'Die Daten selbst liegen weiterhin vollständig auf diesem Computer. Einzelne Verträge und Abrechnungen vor Mitarbeitern zu verbergen folgt in einem späteren Schritt.'
          )}
        </p>
      </CardContent>

      {pinDialog && (
        <StaffPinDialog
          mode={pinDialog}
          onClose={() => setPinDialog(null)}
          onSaved={(next) => {
            apply(next)
            setPinDialog(null)
            toast.success(
              pinDialog === 'enable' ? t('Mitarbeiterzugang eingeschaltet') : t('PIN gespeichert')
            )
          }}
        />
      )}
    </Card>
  )
}

/**
 * Switching staff access on (PIN optional) or setting a new PIN. Rendered only while open, so
 * each opening starts empty.
 */
function StaffPinDialog({
  mode,
  onClose,
  onSaved
}: {
  mode: 'enable' | 'change'
  onClose: () => void
  onSaved: (status: AccessStatusDto) => void
}) {
  const [pin, setPin] = useState('')
  const [repeat, setRepeat] = useState('')
  const [touched, setTouched] = useState(false)
  const enable = trpcReact.access.enable.useMutation({ onSuccess: onSaved, onError: showError })
  const change = trpcReact.access.setPin.useMutation({ onSuccess: onSaved, onError: showError })
  const pending = enable.isPending || change.isPending
  // Switching on, the PIN may stay empty; a new PIN must be given
  const problem = staffPinProblem({ pin, repeat, optional: mode === 'enable' })

  const submit = () => {
    setTouched(true)
    if (problem || pending) return
    if (mode === 'enable') enable.mutate({ pin: pin === '' ? null : pin })
    else change.mutate({ pin })
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'enable' ? t('Mitarbeiterzugang einschalten') : t('PIN festlegen')}
          </DialogTitle>
          <DialogDescription>
            {mode === 'enable'
              ? t(
                  'Die firmeninternen Bereiche werden sofort gesperrt. Mit einer PIN kann nur entsperren, wer sie kennt; ohne PIN genügt ein Klick.'
                )
              : t('Zum Entsperren fragt Bookingium ab jetzt nach dieser PIN.')}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="staff-pin">
              {mode === 'enable'
                ? t('PIN (optional, 4 bis 12 Ziffern)')
                : t('PIN (4 bis 12 Ziffern)')}
            </Label>
            <Input
              id="staff-pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="staff-pin-repeat">{t('PIN wiederholen')}</Label>
            <Input
              id="staff-pin-repeat"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
            />
          </div>
          {touched && problem && (
            <p className="text-sm text-destructive" role="alert">
              {problem}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {t('Abbrechen')}
            </Button>
            <Button type="submit" disabled={pending}>
              {mode === 'enable' ? t('Einschalten') : t('Speichern')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
