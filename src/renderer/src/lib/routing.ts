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
  Map as MapIcon,
  MapPin,
  Music2,
  Plane,
  ClipboardList,
  Receipt,
  Settings,
  Tent,
  Users,
  type LucideIcon
} from 'lucide-react'
import { TERMS } from '../../../main/api/terms'

/**
 * A route information object containing the path, title, group and icon, and its Alt+digit
 * shortcut if it has one.
 */
export type RouteInfo = {
  path: string
  title: string
  group: string
  icon: LucideIcon
  shortcut?: string
}

/**
 * A grouped route with a title and an array of route items.
 */
export type GroupedRoute = {
  title: string
  items: RouteInfo[]
}

/**
 * The application's top-level pages in menu order, grouped by what they are for: planning
 * the shows, the money, the contacts, communication, administration. The Alt+digit shortcuts
 * are given per page (the ten used most), so reordering the menu moves none of them.
 * The icons are shared by the menu and the search palette.
 */
export const ROUTES = {
  dashboard: {
    path: '/',
    title: 'Dashboard',
    group: 'Planung',
    icon: LayoutDashboard,
    shortcut: '1'
  },
  calendar: {
    path: '/calendar',
    title: 'Kalender',
    group: 'Planung',
    icon: CalendarDays,
    shortcut: '2'
  },
  events: {
    path: '/events',
    title: TERMS.event.plural,
    group: 'Planung',
    icon: Music2,
    shortcut: '3'
  },
  // #232: advancing and ticket sales of a tour's shows
  tours: { path: '/tours', title: 'Touren', group: 'Planung', icon: ClipboardList, shortcut: '4' },
  // Shown only while its switch in the settings is on (#102)
  map: { path: '/map', title: 'Karte', group: 'Planung', icon: MapIcon },
  invoices: {
    path: '/invoices',
    title: TERMS.invoice.plural,
    group: 'Finanzen',
    icon: FileText,
    shortcut: '5'
  },
  // #225
  receipts: { path: '/receipts', title: 'Belege', group: 'Finanzen', icon: Receipt },
  trips: { path: '/trips', title: 'Reisekosten', group: 'Finanzen', icon: Plane },
  bands: {
    path: '/band',
    title: TERMS.band.plural,
    group: 'Kontakte',
    icon: Guitar,
    shortcut: '6'
  },
  persons: {
    path: '/persons',
    title: TERMS.person.plural,
    group: 'Kontakte',
    icon: Users,
    shortcut: '7'
  },
  companies: {
    path: '/companies',
    title: TERMS.company.plural,
    group: 'Kontakte',
    icon: Building2,
    shortcut: '8'
  },
  // Both are venues in the database (venue.kind); the detail page lives under the list of its kind
  clubs: {
    path: '/clubs',
    title: TERMS.club.plural,
    group: 'Kontakte',
    icon: MapPin,
    shortcut: '9'
  },
  festivals: { path: '/festivals', title: TERMS.festival.plural, group: 'Kontakte', icon: Tent },
  hotels: { path: '/hotels', title: TERMS.hotel.plural, group: 'Kontakte', icon: Hotel },
  mail: { path: '/mail', title: 'E-Mail', group: 'Kommunikation', icon: Inbox, shortcut: '0' },
  // Mailing lists: who gets a mailing, next to the mail it goes out with
  contactLists: {
    path: '/contact-lists',
    title: TERMS.contactList.plural,
    group: 'Kommunikation',
    icon: Mails
  },
  banks: { path: '/banks', title: TERMS.bank.plural, group: 'Verwaltung', icon: Landmark },
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
 * Alt+digit shortcuts in key order: Alt+1 ... Alt+9, then Alt+0.
 */
export const ROUTE_SHORTCUTS: Array<{ key: string; route: RouteInfo }> = (
  Object.values(ROUTES) as RouteInfo[]
)
  .filter((route) => route.shortcut !== undefined)
  .map((route) => ({ key: route.shortcut!, route }))
  .sort((a, b) => (a.key === '0' ? 10 : Number(a.key)) - (b.key === '0' ? 10 : Number(b.key)))

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
