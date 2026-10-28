import { useEffect, useState } from 'react'
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
import { getPendingFolderName, settleFolderName, subscribeFolderName } from '@/lib/folderName'

/** Rendered once at the app root, next to ConfirmDialogHost */
export function FolderNameDialogHost() {
  const [, force] = useState(0)
  // The value is keyed by the request, so a new request starts fresh without an
  // effect writing state: the open request IS the initial value.
  const [draft, setDraft] = useState<{ request: unknown; value: string } | null>(null)
  useEffect(() => subscribeFolderName(() => force((n) => n + 1)), [])
  const request = getPendingFolderName()
  const open = request !== null
  const value = draft && draft.request === request ? draft.value : (request?.initial ?? '')
  const setValue = (next: string) => setDraft({ request, value: next })
  const submit = () => {
    if (value.trim() === '') return
    settleFolderName(value)
    setDraft(null)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return
        settleFolderName(null)
        setDraft(null)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{request?.title ?? 'Ordner'}</DialogTitle>
          <DialogDescription>
            Der Name darf kein „/“ enthalten und nicht leer sein.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <Label htmlFor="folder-name">Name</Label>
          <Input
            id="folder-name"
            value={value}
            autoFocus
            onChange={(event) => setValue(event.target.value)}
          />
        </form>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              settleFolderName(null)
              setDraft(null)
            }}
          >
            Abbrechen
          </Button>
          <Button disabled={value.trim() === ''} onClick={submit}>
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
