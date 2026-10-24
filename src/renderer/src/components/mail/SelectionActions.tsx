import { Archive, Flag, Mail, MailOpen, Mails, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MessageListItem } from '../../../../main/mailclient/core/types'
import type { MailActions } from './MessageMenu'

/** The reading pane while several mails are selected: what can be done with all of them */
export function SelectionActions({
  items,
  actions,
  onClear
}: {
  items: MessageListItem[]
  actions: MailActions
  onClear: () => void
}) {
  const ids = items.map((m) => m.id)
  const anyUnread = items.some((m) => !m.isRead)
  const anyUnflagged = items.some((m) => !m.isFlagged)
  const { markRead, markFlagged, archive, toTrash } = actions

  return (
    <section
      className="m-auto flex max-w-md flex-col items-center gap-4 p-6 text-center"
      aria-label="Auswahl"
    >
      <Mails className="size-10 stroke-1 text-muted-foreground" aria-hidden />
      <h2 className="text-lg font-semibold">{items.length} E-Mails ausgewählt</h2>
      <div className="flex flex-wrap justify-center gap-2">
        {toTrash && (
          <Button variant="outline" size="sm" onClick={() => toTrash(ids)}>
            <Trash2 />
            In den Papierkorb
          </Button>
        )}
        {archive && (
          <Button variant="outline" size="sm" onClick={() => archive(ids)}>
            <Archive />
            Archivieren
          </Button>
        )}
        {markRead && (
          <Button variant="outline" size="sm" onClick={() => markRead(ids, anyUnread)}>
            {anyUnread ? <MailOpen /> : <Mail />}
            {anyUnread ? 'Als gelesen markieren' : 'Als ungelesen markieren'}
          </Button>
        )}
        {markFlagged && (
          <Button variant="outline" size="sm" onClick={() => markFlagged(ids, anyUnflagged)}>
            <Flag />
            {anyUnflagged ? 'Markieren' : 'Markierung entfernen'}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Zum Verschieben auf einen Ordner ziehen oder mit der rechten Maustaste einen Ordner wählen.
      </p>
      <Button variant="ghost" size="sm" onClick={onClear}>
        Auswahl aufheben
      </Button>
    </section>
  )
}
