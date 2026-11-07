import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/**
 * #142 "Benachrichtigungen" (Einstellungen › Allgemein): the daily reminder of due follow-ups (on
 * by default) and closing to the tray, which keeps reminders and mail coming with the window
 * closed. The tray switch keeps its stored key `mailCloseToTray` from #65.
 */
export function NotificationsCard() {
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
        <CardTitle>Benachrichtigungen</CardTitle>
        <CardDescription>
          Erinnerungen an Termine und fällige Wiedervorlagen, und der Infobereich.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {settings.data && (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Switch
                id="settings-reminder-notifications"
                checked={settings.data.reminderNotifications}
                onCheckedChange={(checked) =>
                  updateSettings.mutate({ reminderNotifications: checked })
                }
                disabled={updateSettings.isPending}
              />
              <Label htmlFor="settings-reminder-notifications">
                Erinnerungen an Termine und fällige Wiedervorlagen
              </Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="settings-close-to-tray"
                checked={settings.data.mailCloseToTray}
                onCheckedChange={(checked) => updateSettings.mutate({ mailCloseToTray: checked })}
                disabled={updateSettings.isPending}
              />
              <Label htmlFor="settings-close-to-tray">
                Beim Schließen im Infobereich weiterlaufen
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Einmal am Tag, beim ersten Start ab 8 Uhr, meldet Bookingium, wie viele Wiedervorlagen
              heute fällig oder überfällig sind; nur die Anzahl, keine Notiz. Termine mit Erinnerung
              meldet es zur gewählten Zeit, mit Tag und Uhrzeit, aber ohne Titel. Ist Bookingium im
              Hintergrund, meldet es Windows, sonst erscheint ein Hinweis im Fenster. Läuft
              Bookingium im Infobereich weiter, kommen Erinnerungen und E-Mails auch bei
              geschlossenem Fenster; beendet wird es dann über das Symbol im Infobereich.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
