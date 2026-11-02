import { useState } from 'react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { RadiusFields } from '@/components/map/RadiusFields'
import {
  draftFromClause,
  parseClauseDraft,
  type RadiusDefaults
} from '@/components/map/radiusDisplay'

/**
 * "Karte (experimentell)" (Einstellungen › Allgemein): the map preview (#102) with events,
 * clubs, festivals and the radius clause (Gebietsschutz) rings. Off by default; off, the menu
 * and the search leave the page out and no form shows radius fields. On, it also holds the
 * clause defaults per venue kind, which venues and events can override.
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

  const defaults = settings.data
    ? { club: settings.data.radiusClub, festival: settings.data.radiusFestival }
    : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Karte (experimentell)</CardTitle>
        <CardDescription>
          Events, Clubs und Festivals auf einer Karte, mit dem Gebietsschutz jeder Veranstaltung: wo
          die Band frei ist und was eine Anfrage blockieren würde.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
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
            Noch in Erprobung. Adressen werden nur offline über die Postleitzahl verortet (DACH),
            nichts verlässt den Rechner. Die Kartenbilder kommen von OpenStreetMap; dabei sieht der
            Kartenanbieter, welcher Ausschnitt angezeigt wird. Eingeschaltet erscheint „Karte“ im
            Menü.
          </p>
        </div>
        {settings.data?.mapPreview && defaults && (
          <RadiusDefaultsForm
            // Remount on saved values, so the inputs follow them
            key={JSON.stringify(defaults)}
            defaults={defaults}
            onSave={(value) =>
              updateSettings.mutate({ radiusClub: value.club, radiusFestival: value.festival })
            }
            isSaving={updateSettings.isPending}
          />
        )}
      </CardContent>
    </Card>
  )
}

/** The clause defaults per venue kind; every field required */
function RadiusDefaultsForm({
  defaults,
  onSave,
  isSaving
}: {
  defaults: RadiusDefaults
  onSave: (value: RadiusDefaults) => void
  isSaving: boolean
}) {
  const [club, setClub] = useState(() => draftFromClause(defaults.club))
  const [festival, setFestival] = useState(() => draftFromClause(defaults.festival))
  const [errors, setErrors] = useState<{ club?: string; festival?: string }>({})

  const handleSave = () => {
    const parsedClub = parseClauseDraft(club)
    const parsedFestival = parseClauseDraft(festival)
    setErrors({
      club: parsedClub.ok ? undefined : parsedClub.error,
      festival: parsedFestival.ok ? undefined : parsedFestival.error
    })
    if (parsedClub.ok && parsedFestival.ok) {
      onSave({ club: parsedClub.value, festival: parsedFestival.value })
    }
  }

  return (
    <div className="space-y-4 border-t pt-4">
      <div>
        <h4 className="text-sm font-medium">Gebietsschutz (Standard)</h4>
        <p className="text-xs text-muted-foreground">
          Wie weit um eine Veranstaltung und wie lange davor und danach die Band nicht anderswo
          spielen soll. Gilt, solange der Club, das Festival oder das Event nichts Eigenes angibt.
          Ausstehende Events zeigen das Risiko, blockieren aber nicht.
        </p>
      </div>
      <div className="space-y-1">
        <Label className="text-sm">Clubs</Label>
        <RadiusFields
          id="settings-radius-club"
          value={club}
          onChange={setClub}
          error={errors.club}
          disabled={isSaving}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-sm">Festivals</Label>
        <RadiusFields
          id="settings-radius-festival"
          value={festival}
          onChange={setFestival}
          error={errors.festival}
          disabled={isSaving}
        />
      </div>
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving}>
          Speichern
        </Button>
      </div>
    </div>
  )
}
