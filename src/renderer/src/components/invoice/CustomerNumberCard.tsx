import { useState } from 'react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Where new Kundennummern start (Einstellungen › Rechnungen). A customer gets its number with
 * its first issued invoice; numbers already taken (entered or imported from DATEV) are skipped.
 */
export function CustomerNumberCard() {
  const utils = trpcReact.useUtils()
  const settings = trpcReact.settings.get.useQuery()
  const [value, setValue] = useState('')

  // Keep the input following the stored setting
  const stored = settings.data?.nextCustomerNumber
  const [lastStored, setLastStored] = useState(stored)
  if (stored !== lastStored) {
    setLastStored(stored)
    setValue(stored === undefined ? '' : String(stored))
  }

  const updateSettings = trpcReact.settings.update.useMutation({
    onSuccess: (saved) => {
      utils.settings.get.setData(undefined, saved)
      toast.success('Einstellung gespeichert')
    },
    onError: (error) =>
      toast.error('Einstellung konnte nicht gespeichert werden', { description: error.message })
  })

  const save = () => {
    const next = Number(value)
    if (!Number.isInteger(next) || next < 1) {
      toast.error('Nächste Kundennummer muss eine ganze Zahl ≥ 1 sein')
      return
    }
    updateSettings.mutate({ nextCustomerNumber: next })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kundennummern</CardTitle>
        <CardDescription>
          Ein Kunde erhält seine Kundennummer mit der ersten gestellten Rechnung. Vergebene Nummern
          (eingetragen oder aus DATEV übernommen) werden übersprungen.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[12rem_auto]">
        <div className="space-y-2">
          <Label htmlFor="settings-next-customer-number">Nächste Kundennummer</Label>
          <Input
            id="settings-next-customer-number"
            type="number"
            min="1"
            step="1"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={settings.isLoading}
          />
        </div>
        <Button onClick={save} disabled={updateSettings.isPending || settings.isLoading}>
          Speichern
        </Button>
      </CardContent>
    </Card>
  )
}
