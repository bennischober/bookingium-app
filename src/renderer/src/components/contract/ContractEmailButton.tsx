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
import { useNavigate } from '@tanstack/react-router'
import { showSendSetupError } from '@/components/mail/sendSetupToast'
import { contractEmailLang, type ContractDocument } from '../../../../main/mail/contractEmail'

type Lang = 'de' | 'en'

const LANGUAGES: Array<{ value: Lang; label: string }> = [
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'Englisch' }
]

/**
 * #120: "Per E-Mail senden" of a contract print page. Main prints the page, fills the
 * "Vertrag" template of the chosen language and opens bookingum's compose window on the
 * "Senden von" account (#136). The language starts from the recipient's country.
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
  const navigate = useNavigate()
  const [lang, setLang] = useState<Lang>(() => contractEmailLang(recipientCountry))

  const send = async () => {
    setSending(true)
    try {
      const result = await window.api.sendContractEmail(contract, id, fileName, lang)
      if (!result.success) {
        showSendSetupError(
          result.error,
          () => void navigate({ to: '/settings', search: { tab: 'email' } }),
          result.setup
        )
        return
      }
      if (result.sent) toast.success('Vertrag gesendet')
      else toast.info('E-Mail nicht gesendet')
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
