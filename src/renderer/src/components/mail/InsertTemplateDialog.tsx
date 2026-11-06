import { useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useRecordChoices, type RecordChoice } from './recordChoices'
import { fillMailTemplate, mailTemplateEventValues } from '../../../../main/mail/mailTemplate'

/**
 * #123: picks one of the user's templates and, for its placeholders, an event. The event a
 * replied-to mail is linked with comes preselected; without an event the event's
 * placeholders stay in the text for the user to fill in.
 */
export function InsertTemplateDialog({
  open,
  onOpenChange,
  accountId,
  inReplyTo,
  recipient,
  onInsert
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: string
  /** The Message-ID a reply answers, for the event it is linked with */
  inReplyTo: string | null
  /** The first To recipient's name, '' if there is none */
  recipient: string
  onInsert: (filled: { subject: string; body: string }) => void
}) {
  const templates = trpcReact.mailTemplate.list.useQuery(undefined, { enabled: open })
  const links = trpcReact.mailLink.linksForMessage.useQuery(
    { accountId, messageId: inReplyTo ?? '' },
    { enabled: open && Boolean(inReplyTo) }
  )
  const linkedEventId = links.data?.find((link) => link.entityType === 'event')?.entityId ?? null

  const [templateId, setTemplateId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  // undefined: not chosen yet, so the linked event applies; null: chosen "no event"
  const [chosen, setChosen] = useState<RecordChoice | null | undefined>(undefined)
  const choices = useRecordChoices('event', search, open)

  const eventId = chosen === undefined ? linkedEventId : (chosen?.id ?? null)
  const event = trpcReact.mailTemplate.event.useQuery(eventId ?? 0, {
    enabled: open && eventId !== null
  })

  const list = templates.data ?? []
  const template = list.find((t) => t.id === templateId) ?? (list.length === 1 ? list[0] : null)

  const insert = () => {
    if (!template) return
    const values = {
      ...(eventId !== null && event.data ? mailTemplateEventValues(event.data) : {}),
      Empfänger: recipient
    }
    onInsert(fillMailTemplate(template, values))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vorlage einfügen</DialogTitle>
          <DialogDescription>
            Der Text kommt an die Stelle des Cursors, der Betreff nur in ein leeres Betreff-Feld.
          </DialogDescription>
        </DialogHeader>

        {templates.isSuccess && list.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Noch keine Vorlage. Vorlagen legen Sie unter Einstellungen › E-Mail an.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="insert-template">Vorlage</Label>
              <Select
                value={template ? String(template.id) : ''}
                onValueChange={(value) => setTemplateId(Number(value))}
              >
                <SelectTrigger id="insert-template">
                  <SelectValue placeholder="Vorlage wählen…" />
                </SelectTrigger>
                <SelectContent>
                  {list.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="insert-template-event">Event für die Platzhalter</Label>
              <Input
                id="insert-template-event"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Event suchen…"
                autoComplete="off"
              />
              <ul
                aria-label="Treffer"
                className="max-h-40 overflow-auto rounded-md border empty:hidden"
              >
                {choices.map((choice) => {
                  const active = eventId === choice.id
                  return (
                    <li key={choice.id}>
                      <button
                        type="button"
                        className={`w-full px-3 py-1.5 text-left text-sm hover:bg-muted ${
                          active ? 'bg-muted font-medium' : ''
                        }`}
                        aria-pressed={active}
                        onClick={() => setChosen(choice)}
                      >
                        {choice.label}
                      </button>
                    </li>
                  )
                })}
              </ul>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {eventId === null
                    ? 'Kein Event: dessen Platzhalter bleiben stehen.'
                    : `Ausgewählt: ${event.data?.name ?? (event.isLoading ? '…' : 'nicht gefunden')}`}
                </span>
                {eventId !== null && (
                  <button
                    type="button"
                    className="underline hover:text-foreground"
                    onClick={() => setChosen(null)}
                  >
                    Ohne Event
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            type="button"
            onClick={insert}
            disabled={!template || (eventId !== null && event.isLoading)}
          >
            Einfügen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
