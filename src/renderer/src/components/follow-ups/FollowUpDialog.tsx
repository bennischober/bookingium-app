import { useState } from 'react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { confirmAction } from '@/lib/confirm'
import { addDays, DUE_PRESETS, localIsoDate } from '@/lib/followUps'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { FollowUpDto, FollowUpRecord } from '../../../../main/api/schemas/followUp.schema'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit this follow-up; without it the dialog creates one */
  followUp?: FollowUpDto
  /** Create on this record; without it (and without followUp) a general one */
  record?: FollowUpRecord & { name: string }
}

/** Create or edit a follow-up (Wiedervorlage): a due date and a note */
export function FollowUpDialog({ open, onOpenChange, followUp, record }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted per opening, so the form starts fresh each time */}
        <FollowUpForm followUp={followUp} record={record} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function FollowUpForm({
  followUp,
  record,
  onDone
}: Pick<Props, 'followUp' | 'record'> & { onDone: () => void }) {
  const today = localIsoDate()
  const [dueDate, setDueDate] = useState(followUp?.dueDate ?? addDays(today, 7))
  const [note, setNote] = useState(followUp?.note ?? '')

  const utils = trpcReact.useUtils()
  const onSuccess = (message: string) => {
    void utils.followUp.invalidate()
    toast.success(message)
    onDone()
  }
  const onError = (error: { message: string }) =>
    toast.error('Wiedervorlage konnte nicht gespeichert werden', { description: error.message })

  const create = trpcReact.followUp.create.useMutation({
    onSuccess: () => onSuccess('Wiedervorlage angelegt'),
    onError
  })
  const update = trpcReact.followUp.update.useMutation({
    onSuccess: () => onSuccess('Wiedervorlage gespeichert'),
    onError
  })
  const remove = trpcReact.followUp.delete.useMutation({
    onSuccess: () => onSuccess('Wiedervorlage gelöscht'),
    onError
  })

  const saving = create.isLoading || update.isLoading || remove.isLoading
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && note.trim() !== ''
  const recordName = followUp ? followUp.record?.name : record?.name

  const submit = () => {
    if (!valid || saving) return
    if (followUp) update.mutate({ id: followUp.id, dueDate, note })
    else create.mutate({ dueDate, note, record: record && { type: record.type, id: record.id } })
  }

  const handleDelete = async () => {
    if (!followUp) return
    if (
      await confirmAction({
        title: 'Wiedervorlage löschen?',
        description: 'Zum Abhaken reicht „Erledigt“; Löschen entfernt sie ganz.',
        confirmLabel: 'Löschen',
        destructive: true
      })
    ) {
      remove.mutate(followUp.id)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <DialogHeader>
        <DialogTitle>{followUp ? 'Wiedervorlage bearbeiten' : 'Neue Wiedervorlage'}</DialogTitle>
        <DialogDescription>
          {recordName
            ? `Zu ${recordName}. Erscheint am Fälligkeitstag auf dem Dashboard.`
            : 'Allgemein, ohne Datensatz. Erscheint am Fälligkeitstag auf dem Dashboard.'}
        </DialogDescription>
      </DialogHeader>

      <div className="my-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="follow-up-due">Fällig am</Label>
          <Input
            id="follow-up-due"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className="w-44"
          />
          <div className="flex flex-wrap gap-1.5">
            {DUE_PRESETS.map((preset) => {
              const date = addDays(today, preset.days)
              return (
                <Button
                  key={preset.label}
                  type="button"
                  size="sm"
                  variant={dueDate === date ? 'secondary' : 'outline'}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setDueDate(date)}
                >
                  {preset.label}
                </Button>
              )
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="follow-up-note">Notiz</Label>
          <Textarea
            id="follow-up-note"
            autoFocus
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              // Ctrl+Enter saves; Enter alone makes a new line
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                submit()
              }
            }}
            placeholder="z. B. Vertrag zurück? Nachhaken"
          />
        </div>
      </div>

      <DialogFooter className="gap-2 sm:justify-between">
        {followUp ? (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => void handleDelete()}
            disabled={saving}
          >
            Löschen
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Abbrechen
          </Button>
          <Button type="submit" disabled={!valid || saving}>
            Speichern
          </Button>
        </div>
      </DialogFooter>
    </form>
  )
}
