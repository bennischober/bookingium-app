import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from './button'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut
} from '@/components/ui/command'
import {
  Building2,
  Calendar,
  CirclePlus,
  Guitar,
  HandCoins,
  Hotel,
  LayoutDashboard,
  MapPin,
  Music2,
  User,
  Users
} from 'lucide-react'
import { trpcReact } from '@/main'

type StaticRoute =
  | '/'
  | '/calendar'
  | '/events'
  | '/band'
  | '/venues'
  | '/hotels'
  | '/persons'
  | '/companies'
  | '/banks'

type RecentCommand = {
  id: string
  label: string
  type: 'route' | 'event'
  path?: StaticRoute
  eventId?: number
}

const RECENTS_STORAGE_KEY = 'bookingium-search-recents'
const MIN_SEARCH_LENGTH = 2
const SEARCH_DEBOUNCE_MS = 200

const ROUTE_COMMANDS: Array<{
  title: string
  description: string
  path: StaticRoute
  icon: React.ReactNode
  aliases?: string[]
}> = [
  {
    title: 'Dashboard',
    description: 'Übersicht und KPIs öffnen',
    path: '/',
    icon: <LayoutDashboard />,
    aliases: ['home', 'landing', 'overview']
  },
  {
    title: 'Kalender',
    description: 'Terminkalender öffnen',
    path: '/calendar',
    icon: <Calendar />,
    aliases: ['agenda', 'schedule']
  },
  {
    title: 'Events',
    description: 'Alle Gigs und Deal Memos öffnen',
    path: '/events',
    icon: <Music2 />,
    aliases: ['gigs', 'shows', 'event hub']
  },
  {
    title: 'Bands',
    description: 'Künstlerverzeichnis öffnen',
    path: '/band',
    icon: <Guitar />
  },
  {
    title: 'Spielstätten',
    description: 'Spielstättenverzeichnis öffnen',
    path: '/venues',
    icon: <MapPin />
  },
  {
    title: 'Hotels',
    description: 'Hotelverzeichnis öffnen',
    path: '/hotels',
    icon: <Hotel />,
    aliases: ['accommodation']
  },
  {
    title: 'Personen',
    description: 'Personen-Stammdaten öffnen',
    path: '/persons',
    icon: <Users />,
    aliases: ['contacts', 'person relations', 'relations']
  },
  {
    title: 'Firmen',
    description: 'Firmen-Stammdaten öffnen',
    path: '/companies',
    icon: <Building2 />
  },
  {
    title: 'Banken',
    description: 'Bankverbindungen öffnen',
    path: '/banks',
    icon: <HandCoins />
  }
]

const SearchButton = () => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [recentCommands, setRecentCommands] = useState<RecentCommand[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENTS_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as RecentCommand[]
      if (Array.isArray(parsed)) {
        setRecentCommands(parsed.slice(0, 8))
      }
    } catch {
      setRecentCommands([])
    }
  }, [])

  useEffect(() => {
    if (!open) return

    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [open, query])

  const searchEnabled = open && debouncedQuery.length >= MIN_SEARCH_LENGTH

  const events = trpcReact.dealMemo.getAllPaginated.useQuery(
    { page: 1, pageSize: 8, search: debouncedQuery },
    { enabled: searchEnabled }
  )
  const bands = trpcReact.band.getAllPaginated.useQuery(
    { page: 1, pageSize: 8, search: debouncedQuery },
    { enabled: searchEnabled }
  )
  const companies = trpcReact.company.getAllPaginated.useQuery(
    { page: 1, pageSize: 8, search: debouncedQuery },
    { enabled: searchEnabled }
  )
  const persons = trpcReact.person.getAllPaginated.useQuery(
    { page: 1, pageSize: 8, search: debouncedQuery },
    { enabled: searchEnabled }
  )
  const venues = trpcReact.venue.getAllPaginated.useQuery(
    { page: 1, pageSize: 8, search: debouncedQuery },
    { enabled: searchEnabled }
  )
  const hotels = trpcReact.hotel.getAllPaginated.useQuery(
    { page: 1, pageSize: 8, search: debouncedQuery },
    { enabled: searchEnabled }
  )

  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      setOpen((prev) => !prev)
    }
  }

  React.useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const persistRecent = (entry: RecentCommand) => {
    setRecentCommands((prev) => {
      const withoutDuplicate = prev.filter((item) => item.id !== entry.id)
      const next = [entry, ...withoutDuplicate].slice(0, 8)

      try {
        localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Ignore storage errors and keep in-memory recents.
      }

      return next
    })
  }

  const runAndClose = (cb: () => void, recent?: RecentCommand) => {
    cb()
    if (recent) persistRecent(recent)
    setQuery('')
    setDebouncedQuery('')
    setOpen(false)
  }

  const eventsQuickList = events.data?.items ?? []
  const personsQuickList = persons.data?.items ?? []
  const companiesQuickList = companies.data?.items ?? []
  const bandsQuickList = bands.data?.items ?? []
  const venuesQuickList = venues.data?.items ?? []
  const hotelsQuickList = hotels.data?.items ?? []

  const hasTypedQuery = debouncedQuery.length >= MIN_SEARCH_LENGTH
  const hasRecordMatches =
    eventsQuickList.length > 0 ||
    personsQuickList.length > 0 ||
    companiesQuickList.length > 0 ||
    bandsQuickList.length > 0 ||
    venuesQuickList.length > 0 ||
    hotelsQuickList.length > 0

  const isAnyLoading =
    events.isLoading ||
    bands.isLoading ||
    companies.isLoading ||
    persons.isLoading ||
    venues.isLoading ||
    hotels.isLoading

  const emptyMessage = useMemo(() => {
    if (!hasTypedQuery)
      return `Geben Sie mindestens ${MIN_SEARCH_LENGTH} Zeichen ein, um Einträge zu suchen.`
    if (isAnyLoading) return 'Suche läuft...'
    if (!hasRecordMatches) return 'Keine passenden Einträge gefunden.'
    return 'Keine Ergebnisse gefunden.'
  }, [hasTypedQuery, isAnyLoading, hasRecordMatches])

  return (
    <div className="flex flex-col gap-4">
      <Button onClick={() => setOpen(true)} variant="outline" size="sm">
        Alles suchen...
        <span className="bg-muted text-muted-foreground ml-2 rounded-lg px-2 py-1 font-mono text-xs">
          Ctrl + K
        </span>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Seiten, Einträge oder Aktionen suchen..."
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>{emptyMessage}</CommandEmpty>

          {recentCommands.length > 0 && (
            <>
              <CommandGroup heading="Letzte Befehle">
                {recentCommands.map((recent) => (
                  <CommandItem
                    key={recent.id}
                    value={recent.label}
                    onSelect={() => {
                      if (recent.type === 'route' && recent.path) {
                        const path = recent.path
                        runAndClose(() => navigate({ to: path }), recent)
                        return
                      }

                      if (recent.type === 'event' && recent.eventId) {
                        runAndClose(
                          () =>
                            navigate({
                              to: '/events/$eventId',
                              params: { eventId: String(recent.eventId) }
                            }),
                          recent
                        )
                      }
                    }}
                  >
                    <Calendar />
                    <span>{recent.label}</span>
                    <CommandShortcut>Letzte</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          <CommandGroup heading="Navigation">
            {ROUTE_COMMANDS.map((route) => (
              <CommandItem
                key={route.path}
                value={`${route.title} ${route.description}`}
                keywords={route.aliases}
                onSelect={() =>
                  runAndClose(() => navigate({ to: route.path }), {
                    id: `route:${route.path}`,
                    label: route.title,
                    type: 'route',
                    path: route.path
                  })
                }
              >
                {route.icon}
                <span>{route.title}</span>
                <CommandShortcut>Öffnen</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Aktionen">
            <CommandItem
              value="create new event"
              keywords={['add event', 'new gig']}
              onSelect={() =>
                runAndClose(() => navigate({ to: '/events' }), {
                  id: 'route:/events:create',
                  label: 'Neues Event anlegen',
                  type: 'route',
                  path: '/events'
                })
              }
            >
              <CirclePlus />
              <span>Neues Event anlegen</span>
              <CommandShortcut>Events</CommandShortcut>
            </CommandItem>
            <CommandItem
              value="person relations"
              keywords={['relations', 'contacts relationships']}
              onSelect={() =>
                runAndClose(() => navigate({ to: '/persons' }), {
                  id: 'route:/persons:relations',
                  label: 'Personen-Beziehungen öffnen',
                  type: 'route',
                  path: '/persons'
                })
              }
            >
              <Users />
              <span>Personen-Beziehungen öffnen</span>
              <CommandShortcut>Personen</CommandShortcut>
            </CommandItem>
          </CommandGroup>

          {hasTypedQuery && (
            <>
              <CommandSeparator />

              <CommandGroup heading="Einträge: Events">
                {eventsQuickList.map((event) => (
                  <CommandItem
                    key={`event-${event.id}`}
                    value={`${event.name} ${event.bandName} ${event.venueName ?? ''}`}
                    keywords={['event', 'gig', 'show']}
                    onSelect={() =>
                      runAndClose(
                        () =>
                          navigate({
                            to: '/events/$eventId',
                            params: { eventId: String(event.id) }
                          }),
                        {
                          id: `event:${event.id}`,
                          label: `${event.name} (${event.bandName})`,
                          type: 'event',
                          eventId: event.id
                        }
                      )
                    }
                  >
                    <Music2 />
                    <span>{event.name}</span>
                    <CommandShortcut>{event.bandName}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>

              <CommandGroup heading="Einträge: Personen">
                {personsQuickList.map((person) => (
                  <CommandItem
                    key={`person-${person.id}`}
                    value={`${person.firstName} ${person.lastName}`}
                    keywords={['person', 'contact']}
                    onSelect={() => runAndClose(() => navigate({ to: '/persons' }))}
                  >
                    <User />
                    <span>
                      {person.firstName} {person.lastName}
                    </span>
                    <CommandShortcut>Personen</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>

              <CommandGroup heading="Einträge: Firmen / Bands / Spielstätten / Hotels">
                {companiesQuickList.map((company) => (
                  <CommandItem
                    key={`company-${company.id}`}
                    value={`${company.name} company`}
                    keywords={['company']}
                    onSelect={() => runAndClose(() => navigate({ to: '/companies' }))}
                  >
                    <Building2 />
                    <span>{company.name}</span>
                    <CommandShortcut>Firmen</CommandShortcut>
                  </CommandItem>
                ))}

                {bandsQuickList.map((band) => (
                  <CommandItem
                    key={`band-${band.id}`}
                    value={`${band.name} ${band.genre ?? ''} band`}
                    keywords={['artist']}
                    onSelect={() => runAndClose(() => navigate({ to: '/band' }))}
                  >
                    <Guitar />
                    <span>{band.name}</span>
                    <CommandShortcut>Bands</CommandShortcut>
                  </CommandItem>
                ))}

                {venuesQuickList.map((venue) => (
                  <CommandItem
                    key={`venue-${venue.id}`}
                    value={`${venue.name} ${venue.address?.city ?? ''} venue`}
                    keywords={['location']}
                    onSelect={() => runAndClose(() => navigate({ to: '/venues' }))}
                  >
                    <MapPin />
                    <span>{venue.name}</span>
                    <CommandShortcut>Spielstätten</CommandShortcut>
                  </CommandItem>
                ))}

                {hotelsQuickList.map((hotel) => (
                  <CommandItem
                    key={`hotel-${hotel.id}`}
                    value={`${hotel.name} ${hotel.address?.city ?? ''} hotel`}
                    keywords={['accommodation']}
                    onSelect={() => runAndClose(() => navigate({ to: '/hotels' }))}
                  >
                    <Hotel />
                    <span>{hotel.name}</span>
                    <CommandShortcut>Hotels</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>
    </div>
  )
}

export default SearchButton
