import {
  Building2,
  CalendarDays,
  FileText,
  Guitar,
  Hotel,
  Inbox,
  Landmark,
  LayoutDashboard,
  Mails,
  MapPin,
  Music2,
  Settings,
  Tent,
  Users,
  type LucideIcon
} from 'lucide-react'

/**
 * A route information object containing the path, title, group and icon.
 */
export type RouteInfo = {
  path: string
  title: string
  group: string
  icon: LucideIcon
}

/**
 * A grouped route with a title and an array of route items.
 */
export type GroupedRoute = {
  title: string
  items: RouteInfo[]
}

/**
 * The application's top-level pages. The order here is the menu order (and
 * the order of the Alt+number shortcuts); the icons are shared by the menu
 * and the search palette.
 */
export const ROUTES = {
  dashboard: { path: '/', title: 'Dashboard', group: 'Planung', icon: LayoutDashboard },
  calendar: { path: '/calendar', title: 'Kalender', group: 'Planung', icon: CalendarDays },
  events: { path: '/events', title: 'Events', group: 'Planung', icon: Music2 },
  invoices: { path: '/invoices', title: 'Rechnungen', group: 'Planung', icon: FileText },
  bands: { path: '/band', title: 'Bands', group: 'Kontakte', icon: Guitar },
  persons: { path: '/persons', title: 'Personen', group: 'Kontakte', icon: Users },
  companies: { path: '/companies', title: 'Firmen', group: 'Kontakte', icon: Building2 },
  // Both are venues in the database (venue.kind); the detail page lives under the list of its kind
  clubs: { path: '/clubs', title: 'Clubs', group: 'Kontakte', icon: MapPin },
  festivals: { path: '/festivals', title: 'Festivals', group: 'Kontakte', icon: Tent },
  hotels: { path: '/hotels', title: 'Hotels', group: 'Kontakte', icon: Hotel },
  contactLists: { path: '/contact-lists', title: 'Verteiler', group: 'Kontakte', icon: Mails },
  mail: { path: '/mail', title: 'E-Mail', group: 'Kommunikation', icon: Inbox },
  banks: { path: '/banks', title: 'Banken', group: 'Verwaltung', icon: Landmark },
  settings: { path: '/settings', title: 'Einstellungen', group: 'Verwaltung', icon: Settings }
} as const satisfies Record<string, RouteInfo>

/**
 * Groups the routes by their group property.
 * @param isShown leaves a route out of the menu (a page while its experimental switch is off)
 * @returns An array of grouped routes.
 */
export const getGroupedRoutes = (
  isShown: (route: RouteInfo) => boolean = () => true
): GroupedRoute[] => {
  const grouped = new Map<string, RouteInfo[]>()

  Object.values(ROUTES).forEach((route) => {
    if (!isShown(route)) return
    const group = grouped.get(route.group) || []
    group.push(route)
    grouped.set(route.group, group)
  })

  return Array.from(grouped.entries()).map(([title, items]) => ({
    title,
    items
  }))
}

/**
 * Alt+digit shortcuts, assigned in menu order: Alt+1 ... Alt+9, then Alt+0.
 */
export const ROUTE_SHORTCUTS: Array<{ key: string; route: RouteInfo }> = Object.values(ROUTES)
  .slice(0, 10)
  .map((route, index) => ({ key: String((index + 1) % 10), route }))

export const getRouteShortcut = (path: string): string | undefined =>
  ROUTE_SHORTCUTS.find((shortcut) => shortcut.route.path === path)?.key

/**
 * Whether a menu route is active for the current path: its own page and its
 * detail pages (e.g. /events for /events/3, /persons for /persons/1).
 * The dashboard ('/') only matches itself.
 */
export const isRouteActive = (routePath: string, currentPath: string): boolean => {
  if (routePath === '/') return currentPath === '/'
  return currentPath === routePath || currentPath.startsWith(`${routePath}/`)
}
