import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { confirmAction } from '@/lib/confirm'

/**
 * #162: the delete action in a detail page header. It asks first, with the same
 * dialog as the list's row action; the page runs the mutation and leaves for the list.
 */
export function DeleteRecordButton({
  confirmTitle,
  onDelete,
  pending = false
}: {
  /** Question of the confirm dialog, e.g. „Name“ löschen? */
  confirmTitle: string
  onDelete: () => void
  pending?: boolean
}) {
  const handleClick = async () => {
    const confirmed = await confirmAction({
      title: confirmTitle,
      description: 'Diese Aktion kann nicht rückgängig gemacht werden.',
      confirmLabel: 'Löschen',
      destructive: true
    })
    if (confirmed) onDelete()
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      className="gap-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      disabled={pending}
      onClick={() => void handleClick()}
    >
      <Trash2 className="h-3.5 w-3.5" />
      Löschen
    </Button>
  )
}
