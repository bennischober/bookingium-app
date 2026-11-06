import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { confirmAction } from '@/lib/confirm'
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
import { Textarea } from '@/components/ui/textarea'
import type { MailTemplateDto } from '../../../../main/api/schemas/mailTemplate.schema'
import { MAIL_TEMPLATE_PLACEHOLDERS } from '../../../../main/mail/mailTemplate'
import { DocumentTemplates } from './DocumentTemplates'

const EMPTY = { name: '', subject: '', body: '' }

function Placeholders() {
  return MAIL_TEMPLATE_PLACEHOLDERS.map((name, index) => (
    <span key={name}>
      {index > 0 && ', '}
      <code className="rounded bg-muted px-1">{`{${name}}`}</code>
    </span>
  ))
}

function MailTemplateDialog({
  template,
  open,
  onOpenChange
}: {
  /** null: a new template */
  template: MailTemplateDto | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const utils = trpcReact.useUtils()
  const [draft, setDraft] = useState(EMPTY)
  // The fields start from the template each time the dialog opens
  const [openedFor, setOpenedFor] = useState<{ open: boolean; id: number | null }>({
    open: false,
    id: null
  })
  const id = template?.id ?? null
  if (openedFor.open !== open || openedFor.id !== id) {
    setOpenedFor({ open, id })
    if (open) setDraft(template ? { ...template } : EMPTY)
  }

  const save = trpcReact.mailTemplate.save.useMutation({
    onSuccess: () => {
      void utils.mailTemplate.list.invalidate()
      toast.success('Vorlage gespeichert')
      onOpenChange(false)
    },
    onError: (error) =>
      toast.error('Vorlage konnte nicht gespeichert werden', { description: error.message })
  })

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!draft.name.trim()) return
    save.mutate({ ...(template ? { id: template.id } : {}), ...draft })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="max-h-[75vh] space-y-4 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{template ? 'Vorlage bearbeiten' : 'Neue Vorlage'}</DialogTitle>
            <DialogDescription>
              Platzhalter: <Placeholders />. Die Werte kommen aus dem Event, das Sie beim Einfügen
              wählen; ohne Event bleiben dessen Platzhalter stehen.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="mail-template-name">Name</Label>
            <Input
              id="mail-template-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="z. B. Bestätigung Anfrage"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mail-template-subject">Betreff</Label>
            <Input
              id="mail-template-subject"
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mail-template-body">Text</Label>
            <Textarea
              id="mail-template-body"
              rows={10}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={!draft.name.trim() || save.isLoading}>
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * "E-Mail-Vorlagen" (Einstellungen › E-Mail), #136 one card for both kinds: the fixed texts of
 * "Per E-Mail senden" (DocumentTemplates) and, #123, the user's own templates, inserted while
 * composing.
 */
export function MailTemplatesCard() {
  const utils = trpcReact.useUtils()
  const templates = trpcReact.mailTemplate.list.useQuery()
  const [editing, setEditing] = useState<MailTemplateDto | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const remove = trpcReact.mailTemplate.delete.useMutation({
    onSuccess: () => {
      void utils.mailTemplate.list.invalidate()
      toast.success('Vorlage gelöscht')
    },
    onError: (error) =>
      toast.error('Vorlage konnte nicht gelöscht werden', { description: error.message })
  })

  const openDialog = (template: MailTemplateDto | null) => {
    setEditing(template)
    setDialogOpen(true)
  }

  const confirmRemove = async (template: MailTemplateDto) => {
    const confirmed = await confirmAction({
      title: `Vorlage „${template.name}“ löschen?`,
      description: 'Bereits geschriebene E-Mails bleiben unverändert.',
      confirmLabel: 'Löschen',
      destructive: true
    })
    if (confirmed) remove.mutate(template.id)
  }

  const list = templates.data ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>E-Mail-Vorlagen</CardTitle>
        <CardDescription>
          Texte für E-Mails aus Bookingium: feste für Rechnungen und Verträge, dazu eigene für
          häufige E-Mails.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <section className="space-y-3" aria-labelledby="settings-document-templates">
          <div>
            <h3 id="settings-document-templates" className="font-medium">
              Für Rechnungen und Verträge
            </h3>
            <p className="text-sm text-muted-foreground">
              „Per E-Mail senden“ füllt diese Texte mit den Daten der Rechnung bzw. des Vertrags.
            </p>
          </div>
          <DocumentTemplates />
        </section>

        <section className="space-y-3" aria-labelledby="settings-own-templates">
          <div>
            <h3 id="settings-own-templates" className="font-medium">
              Eigene Vorlagen
            </h3>
            <p className="text-sm text-muted-foreground">
              Etwa Bestätigungen oder Absagen. Beim Schreiben fügt „Vorlage einfügen“ sie ein, mit
              den Daten eines Events in den Platzhaltern.
            </p>
          </div>
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Vorlage angelegt.</p>
          ) : (
            <ul className="divide-y rounded-md border" aria-label="E-Mail-Vorlagen">
              {list.map((template) => (
                <li key={template.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{template.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {template.subject || 'Ohne Betreff'}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => openDialog(template)}
                    title="Bearbeiten"
                    aria-label={`${template.name} bearbeiten`}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void confirmRemove(template)}
                    title="Löschen"
                    aria-label={`${template.name} löschen`}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <Button variant="outline" onClick={() => openDialog(null)}>
            <Plus className="h-4 w-4" /> Vorlage hinzufügen…
          </Button>
        </section>
      </CardContent>

      <MailTemplateDialog template={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
    </Card>
  )
}
