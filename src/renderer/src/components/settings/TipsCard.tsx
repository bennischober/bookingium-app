import { Lightbulb } from 'lucide-react'
import { reset, setTipState, TIPS } from '@/lib/tips'
import { useTipState } from '@/hooks/useTipState'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/lib/toast'
import { t } from '../../../../main/i18n/translate'

/** #253: tips on or off, and the clicked-away ones back (this computer only) */
export function TipsCard() {
  const state = useTipState()
  const total = Object.keys(TIPS).length
  const hidden = state.dismissed.filter((id) => id in TIPS).length
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4" />
          {t('Tipps')}
        </CardTitle>
        <CardDescription>
          {t(
            'Kurze Hinweise an vielen Stellen erklären, was eine Funktion macht. Gilt nur auf diesem Computer.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch
            id="settings-tips"
            checked={!state.off}
            onCheckedChange={(checked) => setTipState((current) => ({ ...current, off: !checked }))}
          />
          <Label htmlFor="settings-tips">{t('Tipps anzeigen')}</Label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={!state.off && hidden === 0}
            onClick={() => {
              setTipState(reset)
              toast.success(t('Alle Tipps werden wieder angezeigt'))
            }}
          >
            {t('Alle Tipps wieder anzeigen')}
          </Button>
          <span className="text-sm text-muted-foreground">
            {hidden === 0
              ? t('{{total}} Tipps', { total })
              : t('{{hidden}} von {{total}} Tipps ausgeblendet', { hidden, total })}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
