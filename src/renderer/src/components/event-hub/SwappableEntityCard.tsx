import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { InlineCombobox, type InlineComboboxItem } from '@/components/ui/inline-combobox'
import { ExternalLink, Pencil, X } from 'lucide-react'

export interface SwappableEntityCardProps {
  icon: React.ReactNode
  title: string
  /** Primary display name of the currently linked entity */
  currentName: string | null | undefined
  /** Optional subtitle line (genre, capacity, …) */
  currentDetail?: string | null
  /** Combobox items for the swap picker */
  items: InlineComboboxItem[]
  itemsLoading?: boolean
  /** ID of the currently linked entity — used to pre-select in the picker */
  currentId?: number | null
  /** Called immediately when the user picks a new value */
  onSwap: (newId: number | null) => void
  isSaving?: boolean
  /** Whether this field can be cleared (nullable FK) */
  nullable?: boolean
  /** "View" navigation target — only shown when entity is set */
  href?: string
  empty?: string
  /** One row of a list (the event overview's "Beteiligte") instead of a card */
  compact?: boolean
}

export function SwappableEntityCard({
  icon,
  title,
  currentName,
  currentDetail,
  currentId,
  items,
  itemsLoading,
  onSwap,
  isSaving,
  nullable = false,
  href,
  empty = 'Nicht zugewiesen',
  compact = false
}: SwappableEntityCardProps) {
  const [editing, setEditing] = useState(false)
  const hasValue = !!currentName

  const handleSwap = (id: number | null) => {
    onSwap(id)
    setEditing(false)
  }

  const picker = (
    <div className="space-y-2">
      <InlineCombobox
        items={items}
        value={currentId}
        onChange={handleSwap}
        placeholder={`${title} auswählen…`}
        searchPlaceholder={`${title} suchen…`}
        isLoading={itemsLoading}
      />
      {nullable && hasValue && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-destructive hover:text-destructive w-full"
          onClick={() => handleSwap(null)}
        >
          <X className="h-3 w-3 mr-1" />
          {title} entfernen
        </Button>
      )}
    </div>
  )

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <span className="flex w-40 shrink-0 items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {icon}
          {title}
        </span>
        <div className="min-w-0 flex-1 text-sm">
          {editing ? (
            picker
          ) : !hasValue ? (
            <span className="italic text-muted-foreground">{empty}</span>
          ) : (
            <>
              {href ? (
                <Link to={href} className="font-medium hover:underline">
                  {currentName}
                </Link>
              ) : (
                <span className="font-medium">{currentName}</span>
              )}
              {currentDetail && <span className="ml-2 text-muted-foreground">{currentDetail}</span>}
            </>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setEditing((value) => !value)}
          disabled={isSaving}
          aria-label={editing ? `${title}: abbrechen` : `${title} ändern`}
        >
          {editing ? <X className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
          {editing ? 'Abbrechen' : hasValue ? 'Ändern' : 'Zuweisen'}
        </Button>
      </div>
    )
  }

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wider">
            {icon}
            {title}
          </div>
          <div className="flex items-center gap-1">
            {href && hasValue && !editing && (
              <Link to={href}>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                  <ExternalLink className="h-3 w-3" />
                  Ansehen
                </Button>
              </Link>
            )}
            {editing ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1 text-muted-foreground"
                onClick={() => setEditing(false)}
              >
                <X className="h-3 w-3" />
                Abbrechen
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => setEditing(true)}
                disabled={isSaving}
              >
                <Pencil className="h-3 w-3" />
                {hasValue ? 'Ändern' : 'Zuweisen'}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="space-y-2">
            <InlineCombobox
              items={items}
              value={currentId}
              onChange={handleSwap}
              placeholder={`${title} auswählen…`}
              searchPlaceholder={`${title} suchen…`}
              isLoading={itemsLoading}
            />
            {nullable && hasValue && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive w-full"
                onClick={() => handleSwap(null)}
              >
                <X className="h-3 w-3 mr-1" />
                {title} entfernen
              </Button>
            )}
          </div>
        ) : !hasValue ? (
          <p className="text-sm text-muted-foreground italic">{empty}</p>
        ) : (
          <div className="space-y-0.5">
            <p className="font-semibold">{currentName}</p>
            {currentDetail && <p className="text-sm text-muted-foreground">{currentDetail}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
