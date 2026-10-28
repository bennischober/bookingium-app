import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/**
 * "E-Mail (experimentell)" (Einstellungen › E-Mail): the built-in mail client, off by default.
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
          Reiter „E-Mails“ bei Bands, Personen, Firmen, Spielstätten und Events. Ausgeschaltet wird
          nichts gelöscht: Konten und heruntergeladene E-Mails bleiben gespeichert.
        </p>
      </CardContent>
    </Card>
  )
}
