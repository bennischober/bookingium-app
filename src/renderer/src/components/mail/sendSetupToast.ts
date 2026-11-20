import { toast } from '@/lib/toast'
import { t } from '../../../../main/i18n/translate'

/**
 * #136: "Per E-Mail senden" found no account to send from. The error says why (none set up,
 * or the chosen "Senden von" account can't send), the action leads to Einstellungen › E-Mail.
 */
export function showSendSetupError(
  error: string | undefined,
  openSettings: () => void,
  setup: boolean | undefined
): void {
  toast.error(t('E-Mail konnte nicht erstellt werden'), {
    description: error,
    ...(setup ? { action: { label: t('Einstellungen öffnen'), onClick: openSettings } } : {})
  })
}
