import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { backupPasswordProblem } from './backupPassword'
import type {
  BackupStatusDto,
  PreparedRestoreDto
} from '../../../../main/api/schemas/backup.schema'

/**
 * #54: sets (or changes) the password every backup is encrypted with from now on. Rendered only
 * while open, so each opening starts empty.
 */
export function SetBackupPasswordDialog({
  change,
  onClose,
  onSaved
}: {
  /** a password is set already: older backups keep theirs */
  change: boolean
  onClose: () => void
  onSaved: (status: BackupStatusDto) => void
}) {
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [noted, setNoted] = useState(false)
  const [touched, setTouched] = useState(false)
  const save = trpcReact.backup.setPassword.useMutation({ onSuccess: onSaved })
  const problem = backupPasswordProblem({ password, repeat, noted })
  const submit = () => {
    setTouched(true)
    if (problem || save.isPending) return
    save.mutate(password)
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{change ? 'Passwort ändern' : 'Sicherungen verschlüsseln'}</DialogTitle>
          <DialogDescription>
            Ab jetzt werden alle Sicherungen mit diesem Passwort verschlüsselt. Zum Wiederherstellen
            fragt Bookingium danach.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p>
            Ein vergessenes Passwort kann niemand zurücksetzen. Ohne das Passwort sind
            verschlüsselte Sicherungen verloren. Bitte das Passwort notieren und getrennt vom
            Rechner aufbewahren.
            {change && ' Ältere Sicherungen behalten ihr bisheriges Passwort.'}
          </p>
        </div>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="backup-password">Passwort</Label>
            <Input
              id="backup-password"
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="backup-password-repeat">Passwort wiederholen</Label>
            <Input
              id="backup-password-repeat"
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={noted}
              onChange={(event) => setNoted(event.target.checked)}
            />
            Ich habe das Passwort sicher notiert.
          </label>
          {touched && problem && <p className="text-sm text-destructive">{problem}</p>}
          {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
          {/* Enter in a field submits */}
          <button type="submit" hidden />
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Abbrechen
          </Button>
          <Button onClick={submit} disabled={save.isPending || (touched && problem !== null)}>
            {save.isPending ? 'Wird gespeichert…' : 'Verschlüsseln'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * #54: the password of an encrypted backup picked for a restore. A wrong one stays in the
 * dialog to try again; nothing is copied until it is right.
 */
export function RestorePasswordDialog({
  taken,
  onCancel,
  onUnlocked
}: {
  /** "vom 28.10.2026, 14:30" or the folder */
  taken: string
  onCancel: () => void
  onUnlocked: (prepared: PreparedRestoreDto) => void
}) {
  const [password, setPassword] = useState('')
  const unlock = trpcReact.backup.unlockRestore.useMutation({ onSuccess: onUnlocked })
  const submit = () => {
    if (password === '' || unlock.isPending) return
    unlock.mutate(password)
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !unlock.isPending && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Verschlüsselte Sicherung</DialogTitle>
          <DialogDescription>
            Die Sicherung {taken} ist mit einem Passwort verschlüsselt.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <Label htmlFor="backup-restore-password">Passwort der Sicherung</Label>
          <Input
            id="backup-restore-password"
            type="password"
            autoComplete="off"
            autoFocus
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              unlock.reset()
            }}
          />
          {unlock.error && <p className="text-sm text-destructive">{unlock.error.message}</p>}
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={unlock.isPending}>
            Abbrechen
          </Button>
          <Button onClick={submit} disabled={password === '' || unlock.isPending}>
            {unlock.isPending ? 'Wird geprüft…' : 'Weiter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
