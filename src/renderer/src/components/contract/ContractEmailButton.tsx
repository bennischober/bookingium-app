import { useState } from 'react'
import { Mail } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { MailMethod } from '../../../../main/mail/mailProgram'
import { contractEmailLang, type ContractDocument } from '../../../../main/mail/contractEmail'

type Lang = 'de' | 'en'

const TITLES: Record<MailMethod, string> = {
  outlook: 'E-Mail in Outlook geöffnet',
  thunderbird: 'E-Mail in Thunderbird geöffnet',
  mailto: 'E-Mail geöffnet – PDF bitte anhängen',
  files: 'E-Mail gespeichert',
  bookingum: 'Vertrag gesendet'
}

const HINTS: Record<MailMethod, string> = {
  outlook: 'Prüfen und senden.',
  thunderbird: 'Prüfen und senden.',
  mailto: 'Das PDF liegt im geöffneten Ordner – in die E-Mail ziehen.',
  files: 'Kein Mailprogramm gefunden. Die E-Mail (.eml) und das PDF liegen im geöffneten Ordner.',
  bookingum: ''
}

const LANGUAGES: Array<{ value: Lang; label: string }> = [
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'Englisch' }
]

/**
 * #120: "Per E-Mail senden" of a contract print page. Main prints the page, fills the
 * "Vertrag" template of the chosen language and opens it in the mail program, or in
 * bookingum's own editor. The language starts from the recipient's country.
 */
export function ContractEmailButton({
  contract,
  id,
  fileName,
  recipientCountry
}: {
  contract: ContractDocument
  id: number
  fileName: string
  recipientCountry: string | null | undefined
}) {
  const [sending, setSending] = useState(false)
  const [lang, setLang] = useState<Lang>(() => contractEmailLang(recipientCountry))

  const send = async () => {
    setSending(true)
    try {
      const result = await window.api.sendContractEmail(contract, id, fileName, lang)
      if (!result.success || !result.method || !result.pdfPath) {
        toast.error('E-Mail konnte nicht erstellt werden', { description: result.error })
        return
      }
      const pdfPath = result.pdfPath
      const action = {
        label: 'Ordner öffnen',
        onClick: () => void window.api.showEmailFile(pdfPath)
      }
      const notes = [
        result.to
          ? `An ${result.to}.`
          : 'Beim Vertragspartner ist keine E-Mail-Adresse hinterlegt.',
        HINTS[result.method]
      ]
      const show = result.to ? toast.success : toast.warning
      show(TITLES[result.method], { description: notes.filter(Boolean).join(' '), action })
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <Select value={lang} onValueChange={(value) => setLang(value as Lang)}>
        <SelectTrigger className="w-[7.5rem]" aria-label="Sprache der E-Mail">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LANGUAGES.map((language) => (
            <SelectItem key={language.value} value={language.value}>
              {language.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" onClick={() => void send()} disabled={sending}>
        <Mail className="h-4 w-4" /> Per E-Mail senden
      </Button>
    </>
  )
}
