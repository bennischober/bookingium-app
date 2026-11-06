import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/**
 * "E-Mail" (Einstellungen › E-Mail): how the built-in mail client behaves. #136: the client is
 * always part of the app (no switch any more, its worker starts once an account exists); left
 * are the new-mail notification from Windows and the popup in the app (#133, both off by
 * default), and closing to the tray (#65).
 */
export function MailClientSwitchCard() {
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
        <CardTitle>E-Mail</CardTitle>
        <CardDescription>
          Das Postfach in Bookingium: E-Mails lesen, durchsuchen, Personen, Events und Rechnungen
          zuordnen und senden.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {settings.data && (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Switch
                id="settings-mail-notifications"
                checked={settings.data.mailNotifications}
                onCheckedChange={(checked) => updateSettings.mutate({ mailNotifications: checked })}
                disabled={updateSettings.isPending}
              />
              <Label htmlFor="settings-mail-notifications">
                Windows-Benachrichtigung bei neuen E-Mails
              </Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="settings-mail-in-app-notifications"
                checked={settings.data.mailInAppNotifications}
                onCheckedChange={(checked) =>
                  updateSettings.mutate({ mailInAppNotifications: checked })
                }
                disabled={updateSettings.isPending}
              />
              <Label htmlFor="settings-mail-in-app-notifications">
                Hinweis in Bookingium bei neuen E-Mails
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
              Die Zahl ungelesener E-Mails steht immer im Menü und am Symbol im Infobereich. Windows
              meldet neue E-Mails, wenn Bookingium im Hintergrund ist, der Hinweis erscheint, wenn
              das Fenster vorne ist; beide nennen nur die Anzahl und das Konto, keinen Betreff und
              keinen Absender. Läuft Bookingium im Infobereich weiter, werden E-Mails auch bei
              geschlossenem Fenster abgerufen; beendet wird es dann über das Symbol im Infobereich.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
