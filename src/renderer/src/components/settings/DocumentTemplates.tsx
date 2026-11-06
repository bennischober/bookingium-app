import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { confirmAction } from '@/lib/confirm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { EmailTemplateKind } from '../../../../main/api/schemas/settings.schema'
import type { DocumentTemplateDto } from '../../../../main/api/schemas/mailTemplate.schema'
import { INVOICE_EMAIL_PLACEHOLDERS } from '../../../../main/mail/invoiceEmail'
import { CONTRACT_EMAIL_PLACEHOLDERS } from '../../../../main/mail/contractEmail'

const TEMPLATE_KINDS: Array<{ value: EmailTemplateKind; label: string }> = [
  { value: 'invoice', label: 'Rechnung' },
  { value: 'reminder', label: 'Zahlungserinnerung' },
  { value: 'dunning', label: 'Mahnung' },
  // #120: concert and management contracts
  { value: 'contract', label: 'Vertrag' }
]

const LANG_LABELS = { de: 'Deutsch', en: 'Englisch' } as const

function Placeholders({ names }: { names: readonly string[] }) {
  return names.map((name, index) => (
    <span key={name}>
      {index > 0 && ', '}
      <code className="rounded bg-muted px-1">{`{${name}}`}</code>
    </span>
  ))
}

/** Subject and text of one fixed template, saved with its own button */
function TemplateFields({ template }: { template: DocumentTemplateDto }) {
  const utils = trpcReact.useUtils()
  const { kind, lang } = template
  // Edits start from the stored text and follow it when it changes (state adjustment during
  // render; by value, so saving the other language keeps unsaved edits here)
  const [draft, setDraft] = useState({ subject: template.subject, body: template.body })
  const [last, setLast] = useState({ subject: template.subject, body: template.body })
  if (template.subject !== last.subject || template.body !== last.body) {
    const stored = { subject: template.subject, body: template.body }
    setLast(stored)
    setDraft(stored)
  }
  const changed = draft.subject !== template.subject || draft.body !== template.body

  const onError = (error: { message: string }) =>
    toast.error('Vorlage konnte nicht gespeichert werden', { description: error.message })
  const save = trpcReact.mailTemplate.saveDocument.useMutation({
    onSuccess: () => {
      void utils.mailTemplate.documents.invalidate()
      toast.success('Vorlage gespeichert')
    },
    onError
  })
  const reset = trpcReact.mailTemplate.resetDocument.useMutation({
    onSuccess: () => {
      void utils.mailTemplate.documents.invalidate()
      toast.success('Standardtext wiederhergestellt')
    },
    onError
  })
  const busy = save.isLoading || reset.isLoading

  const confirmReset = async () => {
    const confirmed = await confirmAction({
      title: 'Standardtext wiederherstellen?',
      description: `Ihr Text (${LANG_LABELS[lang]}) wird durch den Standardtext ersetzt.`,
      confirmLabel: 'Zurücksetzen'
    })
    if (confirmed) reset.mutate({ kind, lang })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={`settings-email-subject-${lang}`}>Betreff ({LANG_LABELS[lang]})</Label>
        <Input
          id={`settings-email-subject-${lang}`}
          value={draft.subject}
          onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
          disabled={busy}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`settings-email-body-${lang}`}>Text ({LANG_LABELS[lang]})</Label>
        <Textarea
          id={`settings-email-body-${lang}`}
          value={draft.body}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          rows={7}
          disabled={busy}
        />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => save.mutate({ kind, lang, ...draft })}
          disabled={busy || !changed}
        >
          Speichern
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void confirmReset()}
          disabled={busy || !template.edited}
        >
          <RotateCcw className="h-4 w-4" /> Zurücksetzen
        </Button>
      </div>
    </div>
  )
}

/**
 * #136: "Für Rechnungen und Verträge" of the E-Mail-Vorlagen card: the eight fixed texts
 * "Per E-Mail senden" fills. They can be edited and reset, not renamed or deleted, and their
 * placeholders are filled only from the invoice or contract they are sent with.
 */
export function DocumentTemplates() {
  const templates = trpcReact.mailTemplate.documents.useQuery()
  if (!templates.data) return null
  const byKind = (kind: EmailTemplateKind) =>
    templates.data.filter((template) => template.kind === kind)

  return (
    <Tabs defaultValue="invoice" className="@container">
      <TabsList aria-label="Vorlage für">
        {TEMPLATE_KINDS.map((kind) => (
          <TabsTrigger key={kind.value} value={kind.value}>
            {kind.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {TEMPLATE_KINDS.map((kind) => (
        <TabsContent key={kind.value} value={kind.value} className="pt-3">
          {/* Side by side when the card is wide enough */}
          <div className="grid grid-cols-1 gap-6 @3xl:grid-cols-2">
            {byKind(kind.value).map((template) => (
              <TemplateFields key={template.lang} template={template} />
            ))}
          </div>
          <p className="pt-3 text-xs text-muted-foreground">
            {kind.value === 'contract' ? (
              <>
                Für Konzert- und Managementverträge; die Sprache wird beim Senden gewählt
                (vorgeschlagen nach dem Land des Vertragspartners). Platzhalter:{' '}
                <Placeholders names={CONTRACT_EMAIL_PLACEHOLDERS} />.{' '}
                <code className="rounded bg-muted px-1">{'{Datum}'}</code> ist das Konzertdatum bzw.
                der Vertragsbeginn. Die E-Mail geht an den Veranstalter bzw. die Firma der Band.
              </>
            ) : (
              <>
                Die englischen Vorlagen gelten für Rechnungen mit der Vorlage „Agentur (Englisch)“.
                Platzhalter: <Placeholders names={INVOICE_EMAIL_PLACEHOLDERS} />.{' '}
                <code className="rounded bg-muted px-1">{'{Frist}'}</code> ist das Datum in 7 Tagen,
                die Zahlungsfrist in Erinnerung und Mahnung. Die E-Mail geht an die Kontakt-E-Mail
                des Empfängers, sonst an seine allgemeine E-Mail-Adresse.
              </>
            )}
          </p>
        </TabsContent>
      ))}
    </Tabs>
  )
}
