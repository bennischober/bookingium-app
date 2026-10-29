import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
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
  CalendarDays,
  CirclePlus,
  DatabaseBackup,
  FileText,
  Guitar,
  Hotel,
  Mail,
  MapPin,
  Music2,
  Search,
  User,
  type LucideIcon
} from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { mailApi } from '@/lib/mailApi'
import { openDocument } from '@/components/documents/documentFiles'
import { ROUTES } from '@/lib/routing'
import { useMailClientEnabled } from '@/hooks/useMailClientEnabled'
import { useRouteShown } from '@/hooks/useRouteShown'
import { SETTINGS_TAB_LABELS, type SettingsTab } from '@/components/settings/constants'
import type { ListSearch } from '@/hooks/useListSearchActions'

type StaticRoute = (typeof ROUTES)[keyof typeof ROUTES]['path']

type RecentCommand = {
  id: string
  label: string
  type: 'route' | 'event'
  path?: StaticRoute
  /** e.g. { create: true } for "new …" actions (see useListSearchActions) */
  search?: ListSearch
  /** Settings tab for a "/settings" command */
  settingsTab?: SettingsTab
  eventId?: number
}

const RECENTS_STORAGE_KEY = 'bookingium-search-recents'
const MIN_SEARCH_LENGTH = 2
const SEARCH_DEBOUNCE_MS = 200
// C6: the mail search is slower than the app's own, so it waits longer and shows fewer
const MAIL_DEBOUNCE_MS = 400
const MAIL_RESULT_LIMIT = 5

// Palette texts per page; titles, icons and order come from the menu config
const ROUTE_DETAILS: Record<StaticRoute, { description: string; aliases?: string[] }> = {
  '/': { description: 'Übersicht und KPIs öffnen', aliases: ['home', 'landing', 'overview'] },
  '/calendar': { description: 'Terminkalender öffnen', aliases: ['agenda', 'schedule'] },
  '/events': {
    description: 'Alle Gigs und Deal Memos öffnen',
    aliases: ['gigs', 'shows', 'event hub']
  },
  '/invoices': {
    description: 'Rechnungen und Nummerierung öffnen',
    aliases: ['invoices', 'rechnung', 'billing']
  },
  '/band': { description: 'Künstlerverzeichnis öffnen', aliases: ['artists'] },
  '/persons': {
    description: 'Personen-Stammdaten öffnen',
    aliases: ['contacts', 'people', 'kontakte']
  },
  '/companies': { description: 'Firmen-Stammdaten öffnen', aliases: ['companies'] },
  '/venues': { description: 'Spielstättenverzeichnis öffnen', aliases: ['locations'] },
  '/hotels': { description: 'Hotelverzeichnis öffnen', aliases: ['accommodation'] },
  '/contact-lists': {
    description: 'Empfänger für Rundmails und Newsletter',
    aliases: ['newsletter', 'mailing', 'rundmail', 'verteiler']
  },
  '/mail': {
    description: 'Postfach lesen und durchsuchen',
    aliases: ['mail', 'email', 'inbox', 'posteingang', 'postfach']
  },
  '/banks': { description: 'Bankverbindungen öffnen', aliases: ['banks'] },
  '/settings': {
    description: 'Allgemein, Rechnungen, E-Mail, Kalender und Daten',
    aliases: ['settings', 'optionen']
  }
}

// Straight to one settings tab
const SETTINGS_COMMANDS: Array<{
  tab: SettingsTab
  label: string
  icon: LucideIcon
  aliases: string[]
}> = [
  {
    tab: 'general',
    label: 'Eigene Firma und Standardland',
    icon: Building2,
    aliases: ['own company', 'land', 'country']
  },
  {
    tab: 'invoices',
    label: 'Rechnungsnummern und E-Rechnung',
    icon: FileText,
    aliases: ['nummernkreis', 'invoice number', 'zugferd', 'xrechnung', 'qr-code', 'girocode']
  },
  {
    tab: 'email',
    label: 'E-Mail-Vorlagen und Mailprogramm',
    icon: Mail,
    aliases: ['email template', 'outlook', 'thunderbird']
  },
  {
    tab: 'calendar',
    label: 'Kalender-Datei',
    icon: CalendarDays,
    aliases: ['ics', 'abonnieren', 'calendar feed', 'subscribe']
  },
  {
    tab: 'data',
    label: 'Import, Export und Sicherung',
    icon: DatabaseBackup,
    aliases: ['backup', 'csv', 'excel', 'datenordner', 'data folder']
  }
]

const ROUTE_COMMANDS = Object.values(ROUTES).map((route) => ({
  ...route,
  ...ROUTE_DETAILS[route.path]
}))

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
  // D2: files, found by name - the one business object the palette could not see before
  const documents = grouped.filter((r) => r.type === 'document')

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
  // C6: mails come from the mail client, not the app database, and only when a mail
  // account exists. The query is debounced harder than the app search and has its own
  // query key, so a slow mailbox never holds up the palette's other groups: they render
  // from `search` while this one is still loading.
  // The palette is mounted in the root layout from app start, long before an account
  // may be saved: asking only while it is open keeps the answer current instead of
  // caching an empty list from the first render.
  const mailEnabled = useMailClientEnabled()
  const accounts = trpcReact.mail.accounts.list.useQuery(undefined, {
    enabled: open && mailEnabled,
    staleTime: 0
  })
  const mailAccountId = mailEnabled ? (accounts.data?.[0]?.id ?? null) : null
  // pages behind a switched-off experimental switch, and recent jumps to them, go
  const routeShown = useRouteShown()
  const shownRoutes = ROUTE_COMMANDS.filter((route) => routeShown(route.path))
  const shownRecents = recentCommands.filter((recent) => routeShown(recent.path))
  const [debouncedMailQuery, setDebouncedMailQuery] = useState('')
  useEffect(() => {
    if (!open || !mailAccountId) return
    const timeout = window.setTimeout(() => setDebouncedMailQuery(query.trim()), MAIL_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [open, query, mailAccountId])
  const mailSearchEnabled =
    open &&
    mailAccountId !== null &&
    debouncedMailQuery.length >= MIN_SEARCH_LENGTH &&
    debouncedMailQuery === query.trim()
  const mailResults = useQuery({
    queryKey: ['mail', mailAccountId, 'search', debouncedMailQuery],
    queryFn: () =>
      mailApi.search(
        { query: debouncedMailQuery, limit: MAIL_RESULT_LIMIT, wantSnippets: false },
        mailAccountId!
      ),
    enabled: mailSearchEnabled,
    // A palette search is a glance, not a report: keep it cheap and quiet
    staleTime: 30_000,
    retry: false
  })
  const mails = mailSearchEnabled ? (mailResults.data?.items ?? []) : []

  const hasRecordMatches =
    eventsQuickList.length > 0 ||
    personsQuickList.length > 0 ||
    companiesQuickList.length > 0 ||
    bandsQuickList.length > 0 ||
    venuesQuickList.length > 0 ||
    hotelsQuickList.length > 0 ||
    invoicesQuickList.length > 0 ||
    // D2: a file hit is a hit too
    documents.length > 0 ||
    // C6: a mail hit is a hit; the palette must not claim there are none
    mails.length > 0

  const isAnyLoading = searchEnabled && search.isLoading

  const emptyMessage = useMemo(() => {
    if (!hasTypedQuery)
      return `Geben Sie mindestens ${MIN_SEARCH_LENGTH} Zeichen ein, um Einträge zu suchen.`
    if (isAnyLoading) return 'Suche läuft…'
    if (!hasRecordMatches) return 'Keine passenden Einträge gefunden.'
    return 'Keine Ergebnisse gefunden.'
  }, [hasTypedQuery, isAnyLoading, hasRecordMatches])
  return (
    <div className="flex flex-col gap-4">
      {/* Full search field from 1024px; an icon button below, so the top bar
          leaves room for the breadcrumbs */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex h-8 w-8 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-transparent text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-72 lg:justify-start lg:px-3"
        aria-label="Alles suchen (Ctrl+K)"
        title="Alles suchen (Ctrl+K)"
      >
        <Search className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className="hidden flex-1 truncate lg:inline">Alles suchen…</span>
        <kbd className="pointer-events-none hidden rounded border border-muted-foreground/30 bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground group-hover:bg-background lg:inline">
          Ctrl+K
        </kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Seiten, Einträge oder Aktionen suchen…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>{emptyMessage}</CommandEmpty>
          {shownRecents.length > 0 && (
            <>
              <CommandGroup heading="Letzte Befehle">
                {shownRecents.map((recent) => (
                  <CommandItem
                    key={recent.id}
                    value={recent.label}
                    onSelect={() => {
                      if (recent.type === 'route' && recent.settingsTab) {
                        const tab = recent.settingsTab
                        runAndClose(() => navigate({ to: '/settings', search: { tab } }), recent)
                        return
                      }

                      if (recent.type === 'route' && recent.path) {
                        const { path, search } = recent
                        runAndClose(() => navigate({ to: path, search: search ?? {} }), recent)
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
            {shownRoutes.map((route) => (
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
                <route.icon />
                <span>{route.title}</span>
                <CommandShortcut>Öffnen</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Aktionen">
            <CommandItem
              value="Neues Event anlegen create new event"
              keywords={['add event', 'new gig']}
              onSelect={() =>
                runAndClose(() => navigate({ to: '/events', search: { create: true } }), {
                  id: 'route:/events:create',
                  label: 'Neues Event anlegen',
                  type: 'route',
                  path: '/events',
                  search: { create: true }
                })
              }
            >
              <CirclePlus />
              <span>Neues Event anlegen</span>
              <CommandShortcut>Events</CommandShortcut>
            </CommandItem>
            <CommandItem
              value="Neue Rechnung anlegen create new invoice"
              keywords={['add invoice', 'new invoice', 'rechnung']}
              onSelect={() =>
                runAndClose(() => navigate({ to: '/invoices', search: { create: true } }), {
                  id: 'route:/invoices:create',
                  label: 'Neue Rechnung anlegen',
                  type: 'route',
                  path: '/invoices',
                  search: { create: true }
                })
              }
            >
              <CirclePlus />
              <span>Neue Rechnung anlegen</span>
              <CommandShortcut>Rechnungen</CommandShortcut>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Einstellungen">
            {SETTINGS_COMMANDS.map((command) => (
              <CommandItem
                key={command.tab}
                value={`${command.label} Einstellungen ${SETTINGS_TAB_LABELS[command.tab]}`}
                keywords={['settings', ...command.aliases]}
                onSelect={() =>
                  runAndClose(() => navigate({ to: '/settings', search: { tab: command.tab } }), {
                    id: `settings:${command.tab}`,
                    label: command.label,
                    type: 'route',
                    path: '/settings',
                    settingsTab: command.tab
                  })
                }
              >
                <command.icon />
                <span>{command.label}</span>
                <CommandShortcut>{SETTINGS_TAB_LABELS[command.tab]}</CommandShortcut>
              </CommandItem>
            ))}
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
                    onSelect={() =>
                      runAndClose(() =>
                        navigate({
                          to: '/companies/$companyId',
                          params: { companyId: String(company.id) }
                        })
                      )
                    }
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
                    onSelect={() =>
                      runAndClose(() =>
                        navigate({ to: '/band/$bandId', params: { bandId: String(band.id) } })
                      )
                    }
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
                    onSelect={() =>
                      runAndClose(() =>
                        navigate({ to: '/venues/$venueId', params: { venueId: String(venue.id) } })
                      )
                    }
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
                    onSelect={() =>
                      runAndClose(() => navigate({ to: hotel.route, search: { open: hotel.id } }))
                    }
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
                    onSelect={() =>
                      runAndClose(() =>
                        // The page hands a draft on to the sheet of the list
                        navigate({
                          to: '/invoices/$invoiceId',
                          params: { invoiceId: String(invoice.id) }
                        })
                      )
                    }
                  >
                    <FileText />
                    <span>{invoice.label}</span>
                    <CommandShortcut>{invoice.sublabel ?? 'Rechnungen'}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>

              {/* C6: mails from the mail client, a separate and slower source than the
                  app's own records. They render whenever they arrive and never hold up
                  the groups above. */}
              {mails.length > 0 && (
                <CommandGroup heading="E-Mails">
                  {mails.map((mail) => (
                    <CommandItem
                      key={`mail-${mail.id}`}
                      value={`${mail.subject} ${mail.fromName ?? mail.fromEmail} mail email`}
                      keywords={['mail', 'email']}
                      onSelect={() =>
                        runAndClose(() => window.api.openMailWindow(mailAccountId!, mail.id))
                      }
                    >
                      <Mail />
                      <span className="truncate">{mail.subject || '(ohne Betreff)'}</span>
                      <CommandShortcut>{mail.fromName || mail.fromEmail}</CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* D2: a found file opens directly; its record would only make the user look
                  for it a second time. The sublabel already names that record. */}
              {documents.length > 0 && (
                <CommandGroup heading="Dokumente">
                  {documents.map((document) => (
                    <CommandItem
                      key={`document-${document.id}`}
                      value={`${document.label} ${document.sublabel ?? ''} dokument datei file`}
                      keywords={['document', 'datei', 'file']}
                      onSelect={() =>
                        runAndClose(() => {
                          if (document.filePath) void openDocument(document.filePath)
                        })
                      }
                    >
                      <FileText />
                      <span className="truncate">{document.label}</span>
                      <CommandShortcut>{document.sublabel ?? 'Dokumente'}</CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </>
          )}
        </CommandList>
      </CommandDialog>
    </div>
  )
}

export default SearchButton
