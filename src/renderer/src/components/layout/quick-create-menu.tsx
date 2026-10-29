import { useEffect, useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
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
  { label: 'Club', route: ROUTES.clubs },
  { label: 'Festival', route: ROUTES.festivals },
  { label: 'Hotel', route: ROUTES.hotels },
  { label: 'Bank', route: ROUTES.banks }
]

/** Alt + „+“ (main keyboard or numpad) or Ctrl+N */
function isCreateShortcut(event: KeyboardEvent): boolean {
  if (event.metaKey) return false
  if (event.altKey && !event.ctrlKey) return event.key === '+' || event.code === 'NumpadAdd'
  return event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'n'
}

/**
 * Top bar "+ Neu": create any record without navigating there first.
 * Its shortcut creates what the list page shows (a band on Bands); on any
 * other page it opens this menu.
 */
export function QuickCreateMenu() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!isCreateShortcut(event)) return
      event.preventDefault()
      // Not over an open dialog or sheet (its form would be left behind)
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      const item = CREATE_ITEMS.find(({ route }) => route.path === pathname)
      if (item) void navigate({ to: item.route.path, search: { create: true } })
      else setOpen(true)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate, pathname])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" aria-label="Neu anlegen" title="Neu anlegen (Alt + „+“ oder Ctrl+N)">
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
