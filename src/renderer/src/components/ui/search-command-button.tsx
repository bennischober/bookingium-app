import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
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
  FileText,
  Guitar,
  HandCoins,
  Hotel,
  LayoutDashboard,
  MapPin,
  Music2,
  Search,
  User,
  Users
} from 'lucide-react'
import { trpcReact } from '@/lib/trpc'

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
  // Recents are read from localStorage lazily at mount (pure initializer)
  const [recentCommands, setRecentCommands] = useState<RecentCommand[]>(() => {
    try {
      const raw = localStorage.getItem(RECENTS_STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw) as RecentCommand[]
      return Array.isArray(parsed) ? parsed.slice(0, 8) : []
    } catch {
      return []
    }
  })
  const navigate = useNavigate()

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

  // One dedicated search call (LIKE queries on indexed columns, lightweight
  // payloads) instead of six paginated entity queries
  const search = trpcReact.search.search.useQuery(
    { query: debouncedQuery, limit: 4 },
    { enabled: searchEnabled }
  )

  const grouped = search.data?.results ?? []
  const events = grouped.filter((r) => r.type === 'event')
  const bands = grouped.filter((r) => r.type === 'band')
  const companies = grouped.filter((r) => r.type === 'company')
  const persons = grouped.filter((r) => r.type === 'person')
  const venues = grouped.filter((r) => r.type === 'venue')
  const hotels = grouped.filter((r) => r.type === 'hotel')
  const invoices = grouped.filter((r) => r.type === 'invoice')

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

  const eventsQuickList = events
  const personsQuickList = persons
  const companiesQuickList = companies
  const bandsQuickList = bands
  const venuesQuickList = venues
  const hotelsQuickList = hotels
  const invoicesQuickList = invoices

  const hasTypedQuery = debouncedQuery.length >= MIN_SEARCH_LENGTH
  const hasRecordMatches =
    eventsQuickList.length > 0 ||
    personsQuickList.length > 0 ||
    companiesQuickList.length > 0 ||
    bandsQuickList.length > 0 ||
    venuesQuickList.length > 0 ||
    hotelsQuickList.length > 0 ||
    invoicesQuickList.length > 0

  const isAnyLoading = searchEnabled && search.isLoading

  const emptyMessage = useMemo(() => {
    if (!hasTypedQuery)
      return `Geben Sie mindestens ${MIN_SEARCH_LENGTH} Zeichen ein, um Einträge zu suchen.`
    if (isAnyLoading) return 'Suche läuft...'
    if (!hasRecordMatches) return 'Keine passenden Einträge gefunden.'
    return 'Keine Ergebnisse gefunden.'
  }, [hasTypedQuery, isAnyLoading, hasRecordMatches])
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex h-8 w-72 max-w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Alles suchen (Ctrl+K)"
      >
        <Search className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className="flex-1 truncate">Alles suchen...</span>
        <kbd className="pointer-events-none rounded border border-muted-foreground/30 bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground group-hover:bg-background">
          Ctrl+K
        </kbd>
      </button>
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
                    value={`${event.label} event gig show`}
                    keywords={['event', 'gig', 'show']}
                    onSelect={() =>
                      runAndClose(
                        () =>
                          navigate({
                            to: event.route,
                            params: event.routeParams ?? undefined
                          }),
                        {
                          id: `event:${event.id}`,
                          label: event.label,
                          type: 'event',
                          eventId: event.id
                        }
                      )
                    }
                  >
                    <Music2 />
                    <span>{event.label}</span>
                    <CommandShortcut>{event.sublabel ?? ''}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>

              <CommandGroup heading="Einträge: Personen">
                {personsQuickList.map((person) => (
                  <CommandItem
                    key={`person-${person.id}`}
                    value={`${person.label} person contact`}
                    keywords={['person', 'contact']}
                    onSelect={() =>
                      runAndClose(() =>
                        navigate({
                          to: person.route,
                          params: person.routeParams ?? undefined
                        })
                      )
                    }
                  >
                    <User />
                    <span>{person.label}</span>
                    <CommandShortcut>Personen</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>

              <CommandGroup heading="Einträge: Firmen / Bands / Spielstätten / Hotels / Rechnungen">
                {companiesQuickList.map((company) => (
                  <CommandItem
                    key={`company-${company.id}`}
                    value={`${company.label} company firma`}
                    keywords={['company']}
                    onSelect={() => runAndClose(() => navigate({ to: company.route }))}
                  >
                    <Building2 />
                    <span>{company.label}</span>
                    <CommandShortcut>Firmen</CommandShortcut>
                  </CommandItem>
                ))}

                {bandsQuickList.map((band) => (
                  <CommandItem
                    key={`band-${band.id}`}
                    value={`${band.label} ${band.sublabel ?? ''} band artist`}
                    keywords={['artist']}
                    onSelect={() => runAndClose(() => navigate({ to: band.route }))}
                  >
                    <Guitar />
                    <span>{band.label}</span>
                    <CommandShortcut>Bands</CommandShortcut>
                  </CommandItem>
                ))}

                {venuesQuickList.map((venue) => (
                  <CommandItem
                    key={`venue-${venue.id}`}
                    value={`${venue.label} ${venue.sublabel ?? ''} venue location`}
                    keywords={['location']}
                    onSelect={() => runAndClose(() => navigate({ to: venue.route }))}
                  >
                    <MapPin />
                    <span>{venue.label}</span>
                    <CommandShortcut>Spielstätten</CommandShortcut>
                  </CommandItem>
                ))}
                {hotelsQuickList.map((hotel) => (
                  <CommandItem
                    key={`hotel-${hotel.id}`}
                    value={`${hotel.label} ${hotel.sublabel ?? ''} hotel accommodation`}
                    keywords={['accommodation']}
                    onSelect={() => runAndClose(() => navigate({ to: hotel.route }))}
                  >
                    <Hotel />
                    <span>{hotel.label}</span>
                    <CommandShortcut>Hotels</CommandShortcut>
                  </CommandItem>
                ))}

                {invoicesQuickList.map((invoice) => (
                  <CommandItem
                    key={`invoice-${invoice.id}`}
                    value={`${invoice.label} ${invoice.sublabel ?? ''} invoice rechnung`}
                    keywords={['invoice', 'rechnung']}
                    onSelect={() => runAndClose(() => navigate({ to: invoice.route }))}
                  >
                    <FileText />
                    <span>{invoice.label}</span>
                    <CommandShortcut>{invoice.sublabel ?? 'Rechnungen'}</CommandShortcut>
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
