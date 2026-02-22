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
  empty = 'Not assigned'
}: SwappableEntityCardProps) {
  const [editing, setEditing] = useState(false)
  const hasValue = !!currentName

  const handleSwap = (id: number | null) => {
    onSwap(id)
    setEditing(false)
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
                  View
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
                Cancel
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
                {hasValue ? 'Change' : 'Assign'}
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
              placeholder={`Select ${title.toLowerCase()}…`}
              searchPlaceholder={`Search ${title.toLowerCase()}s…`}
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
                Remove {title.toLowerCase()}
              </Button>
            )}
          </div>
        ) : !hasValue ? (
          <p className="text-sm text-muted-foreground italic">{empty}</p>
        ) : (
          <div className="space-y-0.5">
            <p className="font-semibold">{currentName}</p>
            {currentDetail && (
              <p className="text-sm text-muted-foreground">{currentDetail}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
