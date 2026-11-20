import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '../../../../main/i18n/translate'

export function SidebarToggle({
  collapsed,
  onToggle
}: {
  collapsed: boolean
  onToggle: () => void
}) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose
  const label = collapsed ? t('Seitenleiste ausklappen') : t('Seitenleiste einklappen')
  return (
    <Button
      variant="ghost"
      size="icon"
      className="text-muted-foreground"
      onClick={onToggle}
      aria-label={label}
      aria-expanded={!collapsed}
      title={`${label} (Ctrl+B)`}
    >
      <Icon className="h-4 w-4" />
    </Button>
  )
}
