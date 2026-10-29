import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/**
 * "Verteiler (experimentell)" (Einstellungen › Allgemein): off by default until the lists cover
 * more than venues and Veranstalter (#80). Off, the menu and the search leave the page out.
 */
export function ContactListsSwitchCard() {
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
        <CardTitle>Verteiler (experimentell)</CardTitle>
        <CardDescription>
          Empfängerlisten für Rundmails und Newsletter, gefiltert nach Spielstätten und
          Veranstaltern.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-3">
          <Switch
            id="settings-contact-lists"
            checked={settings.data?.contactLists ?? false}
            onCheckedChange={(checked) => updateSettings.mutate({ contactLists: checked })}
            disabled={settings.isLoading || updateSettings.isPending}
          />
          <Label htmlFor="settings-contact-lists">Verteiler einschalten</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          Noch in Erprobung: Empfänger wie Radiosender fehlen bisher. Eingeschaltet erscheint
          „Verteiler“ im Menü. Ausgeschaltet wird nichts gelöscht: gespeicherte Verteiler bleiben
          erhalten.
        </p>
      </CardContent>
    </Card>
  )
}
