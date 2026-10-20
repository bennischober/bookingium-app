import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const THEMES = [
  { value: 'light', label: 'Hell', icon: Sun },
  { value: 'dark', label: 'Dunkel', icon: Moon },
  { value: 'system', label: 'Wie das System', icon: Monitor }
] as const

/** Colour scheme; kept per computer (next-themes, local storage), not in the database */
export function AppearanceCard() {
  const { theme = 'system', setTheme } = useTheme()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Darstellung</CardTitle>
        <CardDescription>Gilt nur auf diesem Computer.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label id="settings-theme">Farbschema</Label>
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
      </CardContent>
    </Card>
  )
}
