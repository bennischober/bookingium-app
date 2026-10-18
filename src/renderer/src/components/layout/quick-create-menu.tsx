import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ROUTES } from '@/lib/routing'

// What can be created from anywhere, in menu order; each opens the "new"
// form on its list page (?create=true, see useListSearchActions)
const CREATE_ITEMS = [
  { label: 'Event', route: ROUTES.events },
  { label: 'Rechnung', route: ROUTES.invoices },
  { label: 'Band', route: ROUTES.bands },
  { label: 'Person', route: ROUTES.persons },
  { label: 'Firma', route: ROUTES.companies },
  { label: 'Spielstätte', route: ROUTES.venues },
  { label: 'Hotel', route: ROUTES.hotels },
  { label: 'Bank', route: ROUTES.banks }
]

/** Top bar "+ Neu": create any record without navigating there first */
export function QuickCreateMenu() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" aria-label="Neu anlegen">
          + Neu
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1">
        <div role="menu" aria-label="Neu anlegen" className="flex flex-col">
          {CREATE_ITEMS.map(({ label, route }) => (
            <button
              key={route.path}
              type="button"
              role="menuitem"
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none"
              onClick={() => {
                setOpen(false)
                void navigate({ to: route.path, search: { create: true } })
              }}
            >
              <route.icon className="h-4 w-4 text-muted-foreground" />
              {label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
