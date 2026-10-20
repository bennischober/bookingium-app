import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/** Payment QR code switch (Einstellungen › Zahlung per QR-Code) */
export function PaymentQrCard() {
  const utils = trpcReact.useUtils()
  const settings = trpcReact.settings.get.useQuery()

  const updateSettings = trpcReact.settings.update.useMutation({
    onSuccess: (saved) => {
      utils.settings.get.setData(undefined, saved)
      toast.success('Einstellung gespeichert')
    },
    onError: (error) =>
      toast.error('Einstellung konnte nicht gespeichert werden', { description: error.message })
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Zahlung per QR-Code</CardTitle>
        <CardDescription>
          Banking-Apps füllen die Überweisung aus dem QR-Code aus (EPC-QR-Code, „GiroCode“).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-3">
          <Switch
            id="settings-payment-qr"
            checked={settings.data?.paymentQr ?? true}
            onCheckedChange={(checked) => updateSettings.mutate({ paymentQr: checked })}
            disabled={settings.isLoading || updateSettings.isPending}
          />
          <Label htmlFor="settings-payment-qr">QR-Code zum Bezahlen auf Rechnungen</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          Gestellte Rechnungen in Euro bekommen unter dem Gesamtbetrag einen QR-Code mit Empfänger,
          IBAN, Betrag und Rechnungsnummer als Verwendungszweck. Ohne gültige IBAN der eigenen
          Firma, bei Entwürfen, stornierten Rechnungen und Stornorechnungen entfällt er.
        </p>
      </CardContent>
    </Card>
  )
}
