import { useNavigate } from '@tanstack/react-router'
import { Lock, LockOpen } from 'lucide-react'
import { useStaffAccess } from '@/hooks/useStaffAccess'
import { Button } from '@/components/ui/button'
import { t } from '../../../../main/i18n/translate'

/**
 * Top bar, #262: shown only on a computer in staff access. Locked, it says so; unlocked, it is a
 * reminder to lock again. Opens Einstellungen › Allgemein, where the Mitarbeiterzugang card is.
 */
export function StaffAccessStatus() {
  const navigate = useNavigate()
  const { status } = useStaffAccess()
  if (!status?.staffMode) return null
  const open = (): void => void navigate({ to: '/settings', search: { tab: undefined } })

  if (status.locked) {
    return (
      <Button
        size="sm"
        variant="ghost"
        aria-label={t('Mitarbeiterzugang')}
        title={t('Mitarbeiterzugang: firmeninterne Bereiche gesperrt')}
        onClick={open}
      >
        <Lock className="h-4 w-4" />
        <span className="hidden lg:inline">{t('Mitarbeiterzugang')}</span>
      </Button>
    )
  }
  return (
    <Button
      size="sm"
      variant="outline"
      className="border-amber-400 text-amber-800 dark:text-amber-300"
      aria-label={t('Entsperrt')}
      title={t('Mitarbeiterzugang entsperrt – zum Sperren in die Einstellungen')}
      onClick={open}
    >
      <LockOpen className="h-4 w-4" />
      <span className="hidden lg:inline">{t('Entsperrt')}</span>
    </Button>
  )
}
