import { useState } from 'react'
import { toast } from 'sonner'
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
import { RecordPicker } from './RecordPicker'
import {
  RECORD_LABELS,
  useRecordChoices,
  type RecordChoice,
  type RecordType
} from './recordChoices'

/**
 * "Zuordnen…": links one mail to a record by hand, for mail the address match missed
 * (a sender nobody stored, a forwarded thread). The link names the mail by its
 * Message-ID, like the automatic ones, so it survives a re-sync. Only the app's own
 * data changes; the mailbox stays as it is.
 */
export function LinkMailDialog({
  open,
  onOpenChange,
  accountId,
  storeMessageId,
  subject
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: string
  /** the mail's Message-ID header */
  storeMessageId: string
  subject: string
}) {
  const [type, setType] = useState<RecordType>('person')
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState<RecordChoice | null>(null)
  const choices = useRecordChoices(type, search, open)

  const utils = trpcReact.useUtils()
  const link = trpcReact.mailLink.link.useMutation({
    onSuccess: (result, input) => {
      // The record's E-Mails tab and the attachment dialog's pre-selection read these
      void utils.mailLink.invalidate()
      const label = chosen?.label ?? RECORD_LABELS[input.entityType]
      if (result.linked) toast.success('Mail zugeordnet', { description: label })
      else toast.info('Die Mail ist schon zugeordnet', { description: label })
      onOpenChange(false)
    },
    onError: (error) =>
      toast.error('Mail konnte nicht zugeordnet werden', { description: error.message })
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mail zuordnen</DialogTitle>
          <DialogDescription className="truncate">{subject || '(Kein Betreff)'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <RecordPicker
            idPrefix="link-mail"
            typeLabel="Zuordnen zu"
            type={type}
            onTypeChange={(next) => {
              setType(next)
              setChosen(null)
            }}
            search={search}
            onSearchChange={setSearch}
            choices={choices}
            selected={chosen}
            onChoose={setChosen}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            disabled={!chosen || link.isPending}
            onClick={() => {
              if (!chosen) return
              link.mutate({
                accountId,
                messageId: storeMessageId,
                entityType: type,
                entityId: chosen.id
              })
            }}
          >
            Zuordnen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
