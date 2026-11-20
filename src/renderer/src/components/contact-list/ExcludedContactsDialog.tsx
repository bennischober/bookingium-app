import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { ContactListRecipientDto } from '../../../../main/api/schemas/contactList.schema'
import { t } from '../../../../main/i18n/translate'

/** The addresses left out as "Keine Werbung", each one with a way back in */
export function ExcludedContactsDialog({
  open,
  onOpenChange,
  excluded,
  memberList,
  restoring,
  onRestore
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  excluded: ContactListRecipientDto[]
  /** The list is a member list (#154), not a filter */
  memberList: boolean
  restoring: boolean
  onRestore: (email: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('Keine Werbung')}</DialogTitle>
          <DialogDescription>
            {memberList
              ? t('Diese Adressen stehen im Verteiler, bekommen aber keine Rundmails.')
              : t('Diese Adressen passen zu den Filtern, bekommen aber keine Rundmails.')}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-80 divide-y overflow-y-auto">
          {excluded.map((row) => (
            <li key={row.email} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{row.name || row.email}</div>
                <div className="truncate text-sm text-muted-foreground">{row.email}</div>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={restoring}
                onClick={() => onRestore(row.email)}
              >
                {t('Wieder aufnehmen')}
              </Button>
            </li>
          ))}
          {excluded.length === 0 && (
            <li className="py-2 text-sm text-muted-foreground">{t('Keine mehr.')}</li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
