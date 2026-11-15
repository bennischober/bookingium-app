import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

/** A name being typed: for a new list, or for renaming the list with `id` */
export type ContactListNameDraft = { id?: number; name: string }

/** Names a mailing list on save, save as and rename */
export function ContactListNameDialog({
  draft,
  onDraftChange,
  onSubmit,
  saving,
  memberList
}: {
  /** null keeps the dialog closed */
  draft: ContactListNameDraft | null
  /** null closes the dialog */
  onDraftChange: (draft: ContactListNameDraft | null) => void
  onSubmit: (draft: ContactListNameDraft) => void
  saving: boolean
  /** The list is a member list (#154), whose contacts a rename keeps */
  memberList: boolean
}) {
  const renaming = draft?.id !== undefined

  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onDraftChange(null)}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (draft) onSubmit(draft)
          }}
        >
          <DialogHeader>
            <DialogTitle>{renaming ? 'Verteiler umbenennen' : 'Verteiler speichern'}</DialogTitle>
            <DialogDescription>
              {renaming && memberList
                ? 'Die Kontakte des Verteilers bleiben gleich.'
                : 'Gespeichert werden die Filter, nicht die Adressen.'}
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-2">
            <Label htmlFor="contact-list-name">Name</Label>
            <Input
              id="contact-list-name"
              autoFocus
              value={draft?.name ?? ''}
              onChange={(event) => draft && onDraftChange({ ...draft, name: event.target.value })}
              placeholder="z. B. Clubs Süddeutschland"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onDraftChange(null)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={!draft?.name.trim() || saving}>
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
