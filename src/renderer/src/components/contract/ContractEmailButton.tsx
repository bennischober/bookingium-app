import { useState } from 'react'
import { Mail } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { useNavigate } from '@tanstack/react-router'
import { showSendSetupError } from '@/components/mail/sendSetupToast'
import type { ContractDocument } from '../../../../main/mail/contractEmail'
import type { DocumentLang } from '../print/DocumentLanguageSelect'

/**
 * #120: "Per E-Mail senden" of a contract print page. Main prints the page, fills the
 * "Vertrag" template and opens bookingum's compose window on the "Senden von" account
 * (#136). The email is in the contract's language, picked on the print page (which starts
 * from the recipient's country).
 */
export function ContractEmailButton({
  contract,
  id,
  fileName,
  lang
}: {
  contract: ContractDocument
  id: number
  fileName: string
  lang: DocumentLang
}) {
  const [sending, setSending] = useState(false)
  const navigate = useNavigate()

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
    <Button variant="outline" onClick={() => void send()} disabled={sending}>
      <Mail className="h-4 w-4" /> Per E-Mail senden
    </Button>
  )
}
