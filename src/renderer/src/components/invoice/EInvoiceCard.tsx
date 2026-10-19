import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/** E-invoice switch (Einstellungen › E-Rechnung) */
export function EInvoiceCard() {
  const utils = trpcReact.useUtils()
  const settings = trpcReact.settings.get.useQuery()

  const updateSettings = trpcReact.settings.update.useMutation({
    onSuccess: (saved) => {
      utils.settings.get.setData(undefined, saved)
      void utils.invoice.eInvoiceCheck.invalidate()
      toast.success('Einstellung gespeichert')
    },
    onError: (error) =>
      toast.error('Einstellung konnte nicht gespeichert werden', { description: error.message })
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>E-Rechnung</CardTitle>
        <CardDescription>
          Ab 2028 Pflicht für Rechnungen an Firmen im Inland; Empfänger müssen sie schon jetzt
          annehmen können.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-3">
          <Switch
            id="settings-einvoice"
            checked={settings.data?.eInvoiceEmbed ?? true}
            onCheckedChange={(checked) => updateSettings.mutate({ eInvoiceEmbed: checked })}
            disabled={settings.isLoading || updateSettings.isPending}
          />
          <Label htmlFor="settings-einvoice">E-Rechnung (ZUGFeRD) in PDF einbetten</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          „Als PDF speichern“ legt bei gestellten Rechnungen die E-Rechnung (ZUGFeRD/Factur-X, EN
          16931) ins PDF. Das PDF sieht gleich aus; Buchhaltungsprogramme lesen die Daten direkt.
          Fehlen Angaben, zeigt die Rechnung, welche – das PDF wird dann ohne E-Rechnung
          gespeichert.
        </p>
      </CardContent>
    </Card>
  )
}
