import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/**
 * "Karte (experimentell)" (Einstellungen › Allgemein): the map preview (#102) with events,
 * clubs, festivals and radius rings. Off by default until the reading of the rings (radius
 * clause?) is confirmed. Off, the menu and the search leave the page out.
 */
export function MapPreviewSwitchCard() {
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
        <CardTitle>Karte (experimentell)</CardTitle>
        <CardDescription>
          Events, Clubs und Festivals auf einer Karte, mit Radius-Ringen um jede Veranstaltung.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-3">
          <Switch
            id="settings-map-preview"
            checked={settings.data?.mapPreview ?? false}
            onCheckedChange={(checked) => updateSettings.mutate({ mapPreview: checked })}
            disabled={settings.isLoading || updateSettings.isPending}
          />
          <Label htmlFor="settings-map-preview">Karte einschalten</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          Noch in Erprobung: Die Ringe sind ein Vorschlag (Clubs 100 km, Festivals 300 km) und
          sollen den Gebietsschutz abbilden – das ist noch zu bestätigen. Adressen werden nur
          offline über die Postleitzahl verortet, nichts verlässt den Rechner. Karte und
          Satellitenbilder kommen von OpenStreetMap; dabei sieht der Kartenanbieter, welcher
          Ausschnitt angezeigt wird. Eingeschaltet erscheint „Karte“ im Menü.
        </p>
      </CardContent>
    </Card>
  )
}
