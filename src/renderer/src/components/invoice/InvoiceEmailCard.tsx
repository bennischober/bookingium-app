import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  DEFAULT_INVOICE_EMAIL,
  type EmailTemplate,
  type MailProgramSetting
} from '../../../../main/api/schemas/settings.schema'
import { INVOICE_EMAIL_PLACEHOLDERS } from '../../../../main/mail/invoiceEmail'

const MAIL_PROGRAMS: Array<{ value: MailProgramSetting; label: string }> = [
  { value: 'auto', label: 'Automatisch' },
  { value: 'outlook', label: 'Outlook (klassisch)' },
  { value: 'thunderbird', label: 'Thunderbird' },
  { value: 'mailto', label: 'Anderes Mailprogramm' },
  { value: 'files', label: 'Nur Dateien speichern' }
]

const MAIL_PROGRAM_HINTS: Record<MailProgramSetting, string> = {
  auto: 'Nach dem Mailprogramm, das Windows für E-Mail-Links nutzt.',
  outlook: 'Öffnet die E-Mail mit PDF als Entwurf.',
  thunderbird: 'Öffnet eine neue E-Mail mit PDF im Anhang.',
  mailto:
    'Öffnet eine neue E-Mail ohne Anhang (z. B. das neue Outlook) und zeigt das PDF zum Hineinziehen.',
  files: 'Speichert E-Mail (.eml) und PDF und öffnet ihren Ordner.'
}

type Lang = 'de' | 'en'
const SETTING_KEYS = { de: 'invoiceEmailDe', en: 'invoiceEmailEn' } as const

/** Subject and text of one template language, saved with its own button */
function TemplateFields({
  lang,
  saved,
  onSave,
  disabled
}: {
  lang: Lang
  saved: EmailTemplate
  onSave: (template: EmailTemplate) => void
  disabled: boolean
}) {
  // Edits start from the stored template and follow it when it changes
  // (state adjustment during render; by value, so saving another setting
  // keeps unsaved edits)
  const [draft, setDraft] = useState(saved)
  const [lastSaved, setLastSaved] = useState(saved)
  if (saved.subject !== lastSaved.subject || saved.body !== lastSaved.body) {
    setLastSaved(saved)
    setDraft(saved)
  }
  const changed = draft.subject !== saved.subject || draft.body !== saved.body
  const isDefault =
    draft.subject === DEFAULT_INVOICE_EMAIL[lang].subject &&
    draft.body === DEFAULT_INVOICE_EMAIL[lang].body

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={`settings-email-subject-${lang}`}>
          Betreff ({lang === 'de' ? 'Deutsch' : 'Englisch'})
        </Label>
        <Input
          id={`settings-email-subject-${lang}`}
          value={draft.subject}
          onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
          disabled={disabled}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`settings-email-body-${lang}`}>
          Text ({lang === 'de' ? 'Deutsch' : 'Englisch'})
        </Label>
        <Textarea
          id={`settings-email-body-${lang}`}
          value={draft.body}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          rows={7}
          disabled={disabled}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSave(draft)} disabled={disabled || !changed}>
          Speichern
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setDraft(DEFAULT_INVOICE_EMAIL[lang])}
          disabled={disabled || isDefault}
        >
          <RotateCcw className="h-4 w-4" /> Standardtext
        </Button>
      </div>
    </div>
  )
}

/** "Per E-Mail senden": mail program and email templates (Einstellungen › E-Mail) */
export function InvoiceEmailCard() {
  const utils = trpcReact.useUtils()
  const settings = trpcReact.settings.get.useQuery()

  const updateSettings = trpcReact.settings.update.useMutation({
    onSuccess: (saved) => {
      utils.settings.get.setData(undefined, saved)
      toast.success('Einstellung gespeichert')
    },
    onError: (error) =>
      toast.error('Einstellung konnte nicht gespeichert werden', { description: error.message })
  })

  const mailProgram = settings.data?.mailProgram ?? 'auto'
  const disabled = settings.isLoading || updateSettings.isPending

  return (
    <Card>
      <CardHeader>
        <CardTitle>E-Mail</CardTitle>
        <CardDescription>
          „Per E-Mail senden“ auf der Rechnung erstellt die E-Mail mit dem PDF – Sie prüfen und
          senden sie im Mailprogramm.
        </CardDescription>
      </CardHeader>
      <CardContent className="@container space-y-6">
        <div className="max-w-sm space-y-2">
          <Label htmlFor="settings-mail-program">Mailprogramm</Label>
          <Select
            value={mailProgram}
            onValueChange={(value) =>
              updateSettings.mutate({ mailProgram: value as MailProgramSetting })
            }
            disabled={disabled}
          >
            <SelectTrigger id="settings-mail-program">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MAIL_PROGRAMS.map((program) => (
                <SelectItem key={program.value} value={program.value}>
                  {program.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{MAIL_PROGRAM_HINTS[mailProgram]}</p>
        </div>

        {/* Side by side when the card is wide enough (it may sit in a column) */}
        <div className="grid grid-cols-1 gap-6 @3xl:grid-cols-2">
          {(['de', 'en'] as const).map((lang) => (
            <TemplateFields
              key={lang}
              lang={lang}
              saved={settings.data?.[SETTING_KEYS[lang]] ?? DEFAULT_INVOICE_EMAIL[lang]}
              onSave={(template) => updateSettings.mutate({ [SETTING_KEYS[lang]]: template })}
              disabled={disabled}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Die englische Vorlage gilt für Rechnungen mit der Vorlage „Agentur (Englisch)“.
          Platzhalter:{' '}
          {INVOICE_EMAIL_PLACEHOLDERS.map((name, index) => (
            <span key={name}>
              {index > 0 && ', '}
              <code className="rounded bg-muted px-1">{`{${name}}`}</code>
            </span>
          ))}
          . Die E-Mail geht an die Kontakt-E-Mail des Empfängers, sonst an seine allgemeine
          E-Mail-Adresse.
        </p>
      </CardContent>
    </Card>
  )
}
