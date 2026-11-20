import { useState } from 'react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { t } from '../../../../main/i18n/translate'

/**
 * Where new Kundennummern start (Einstellungen › Rechnungen). A customer gets its number with
 * its first issued invoice; numbers already taken (entered or imported from DATEV) are skipped.
 */
export function CustomerNumberCard() {
  const utils = trpcReact.useUtils()
  const settings = trpcReact.settings.get.useQuery()
  // What was typed; until then (and after a save) the stored setting shows
  const [typed, setTyped] = useState<string | null>(null)
  const stored = settings.data?.nextCustomerNumber
  const value = typed ?? (stored === undefined ? '' : String(stored))

  const updateSettings = trpcReact.settings.update.useMutation({
    onSuccess: (saved) => {
      utils.settings.get.setData(undefined, saved)
      setTyped(null)
      toast.success(t('Einstellung gespeichert'))
    },
    onError: (error) =>
      toast.error(t('Einstellung konnte nicht gespeichert werden'), { description: error.message })
  })

  const save = () => {
    const next = Number(value)
    if (!Number.isInteger(next) || next < 1) {
      toast.error(t('Nächste Kundennummer muss eine ganze Zahl ≥ 1 sein'))
      return
    }
    updateSettings.mutate({ nextCustomerNumber: next })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Kundennummern')}</CardTitle>
        <CardDescription>
          {t(
            'Ein Kunde erhält seine Kundennummer mit der ersten gestellten Rechnung. Vergebene Nummern (eingetragen oder aus DATEV übernommen) werden übersprungen.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-4">
        <div className="w-48 space-y-2">
          <Label htmlFor="settings-next-customer-number">{t('Nächste Kundennummer')}</Label>
          <Input
            id="settings-next-customer-number"
            type="number"
            min="1"
            step="1"
            value={value}
            onChange={(e) => setTyped(e.target.value)}
            disabled={settings.isLoading}
          />
        </div>
        <Button onClick={save} disabled={updateSettings.isPending || settings.isLoading}>
          {t('Speichern')}
        </Button>
      </CardContent>
    </Card>
  )
}
