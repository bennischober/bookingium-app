import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { toast } from '@/lib/toast'
import {
  getLanguage,
  isLanguage,
  LANGUAGE_NAMES,
  LANGUAGES,
  t
} from '../../../../main/i18n/translate'

const THEMES = [
  { value: 'light', label: t('Hell'), icon: Sun },
  { value: 'dark', label: t('Dunkel'), icon: Moon },
  { value: 'system', label: t('Wie das System'), icon: Monitor }
] as const

/**
 * Colour scheme (next-themes, local storage) and #254 the UI language (a file in the data
 * folder); both kept per computer, not in the shared database
 */
export function AppearanceCard() {
  const { theme = 'system', setTheme } = useTheme()

  const changeLanguage = (value: string): void => {
    // Clicking the active entry would clear a single toggle group
    if (!isLanguage(value) || value === getLanguage()) return
    // The window reloads once the choice is stored
    window.api.setLanguage(value).catch((error: unknown) =>
      toast.error(t('Die Sprache konnte nicht gespeichert werden.'), {
        description: error instanceof Error ? error.message : String(error)
      })
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Darstellung')}</CardTitle>
        <CardDescription>{t('Gilt nur auf diesem Computer.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label id="settings-theme">{t('Farbschema')}</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            className="justify-start"
            aria-labelledby="settings-theme"
            value={theme}
            // Clicking the active entry would clear a single toggle group
            onValueChange={(value) => value && setTheme(value)}
          >
            {THEMES.map(({ value, label, icon: Icon }) => (
              <ToggleGroupItem key={value} value={value}>
                <Icon className="size-4" />
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="space-y-2">
          <Label id="settings-language">{t('Sprache der Oberfläche')}</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            className="justify-start"
            aria-labelledby="settings-language"
            value={getLanguage()}
            onValueChange={changeLanguage}
          >
            {LANGUAGES.map((language) => (
              // Each name in its own language, so it can be found without reading the other
              <ToggleGroupItem key={language} value={language} lang={language}>
                {LANGUAGE_NAMES[language]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-sm text-muted-foreground">
            {t(
              'Dokumente für Dritte (Verträge, Rechnungen, E-Mails) behalten ihre eigene Sprache.'
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
