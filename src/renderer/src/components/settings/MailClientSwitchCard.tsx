import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/**
 * "E-Mail (experimentell)" (Einstellungen › E-Mail): the built-in mail client, off by default.
 * While it is on, two more switches (#65): the new-mail notification and closing to the tray.
 * Main starts or stops its worker with the setting; the renderer hides the mail page, the E-Mails
 * tabs, the mail search and the own editor while it is off.
 */
export function MailClientSwitchCard() {
  const utils = trpcReact.useUtils()
  const settings = trpcReact.settings.get.useQuery()

  const updateSettings = trpcReact.settings.update.useMutation({
    onSuccess: (saved) => {
      utils.settings.get.setData(undefined, saved)
      void utils.mail.invalidate()
      toast.success('Einstellung gespeichert')
    },
    onError: (error) =>
      toast.error('Einstellung konnte nicht gespeichert werden', { description: error.message })
  })

  const toggle = (checked: boolean) =>
    updateSettings.mutate({
      mailClient: checked,
      // the own editor needs the mail client; without it invoices go to the system's program
      ...(!checked && settings.data?.mailProgram === 'bookingum' ? { mailProgram: 'auto' } : {})
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle>E-Mail (experimentell)</CardTitle>
        <CardDescription>
          Ein eigenes Postfach in Bookingium: E-Mails lesen, durchsuchen, Personen, Events und
          Rechnungen zuordnen und senden.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-3">
          <Switch
            id="settings-mail-client"
            checked={settings.data?.mailClient ?? false}
            onCheckedChange={toggle}
            disabled={settings.isLoading || updateSettings.isPending}
          />
          <Label htmlFor="settings-mail-client">E-Mail-Client einschalten</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          Noch in Erprobung. Eingeschaltet erscheinen „E-Mail“ im Menü, die Konten unten und der
          Reiter „E-Mails“ bei Bands, Personen, Firmen, Clubs, Festivals und Events. Ausgeschaltet
          wird nichts gelöscht: Konten und heruntergeladene E-Mails bleiben gespeichert.
        </p>
        {settings.data?.mailClient && (
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center gap-3">
              <Switch
                id="settings-mail-notifications"
                checked={settings.data.mailNotifications}
                onCheckedChange={(checked) => updateSettings.mutate({ mailNotifications: checked })}
                disabled={updateSettings.isPending}
              />
              <Label htmlFor="settings-mail-notifications">
                Benachrichtigung bei neuen E-Mails
              </Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="settings-mail-close-to-tray"
                checked={settings.data.mailCloseToTray}
                onCheckedChange={(checked) => updateSettings.mutate({ mailCloseToTray: checked })}
                disabled={updateSettings.isPending}
              />
              <Label htmlFor="settings-mail-close-to-tray">
                Beim Schließen im Infobereich weiterlaufen
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Die Benachrichtigung nennt nur die Anzahl und das Konto, keinen Betreff und keinen
              Absender. Läuft Bookingium im Infobereich weiter, werden E-Mails auch bei
              geschlossenem Fenster abgerufen; beendet wird es dann über das Symbol im Infobereich.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
