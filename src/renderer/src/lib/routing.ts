/**
 * A route information object containing the path, title, and group.
 */
export type RouteInfo = {
  path: string
  title: string
  group: string
  breadcrumb?: string // Optional custom breadcrumb label
}

/**
 * A grouped route with a title and an array of route items.
 */
export type GroupedRoute = {
  title: string
  items: RouteInfo[]
}

/**
 * A constant object defining the application's routes.
 */
export const ROUTES = {
  dashboard: {
    path: '/',
    title: '📊 Dashboard',
    group: 'Hauptmenü',
    breadcrumb: 'Dashboard'
  },
  calendar: {
    path: '/calendar',
    title: '📅 Kalender',
    group: 'Hauptmenü',
    breadcrumb: 'Kalender'
  },
  events: {
    path: '/events',
    title: '🎸 Events',
    group: 'Produktion',
    breadcrumb: 'Events'
  },
  invoices: {
    path: '/invoices',
    title: '📄 Rechnungen',
    group: 'Produktion',
    breadcrumb: 'Rechnungen'
  },
  bands: {
    path: '/band',
    title: '🥁 Bands',
    group: 'Verzeichnis',
    breadcrumb: 'Bands'
  },
  venues: {
    path: '/venues',
    title: '📍 Spielstätten',
    group: 'Verzeichnis',
    breadcrumb: 'Spielstätten'
  },
  hotels: {
    path: '/hotels',
    title: '🏨 Hotels',
    group: 'Verzeichnis',
    breadcrumb: 'Hotels'
  },
  persons: {
    path: '/persons',
    title: '👤 Personen',
    group: 'Stammdaten',
    breadcrumb: 'Personen'
  },
  companies: {
    path: '/companies',
    title: '🏢 Firmen',
    group: 'Stammdaten',
    breadcrumb: 'Firmen'
  },
  banks: {
    path: '/banks',
    title: '🏦 Banken',
    group: 'Stammdaten',
    breadcrumb: 'Banken'
  }
} as const

/**
 * Groups the routes by their group property.
 * @returns An array of grouped routes.
 */
export const getGroupedRoutes = (): GroupedRoute[] => {
  const grouped = new Map<string, RouteInfo[]>()

  Object.values(ROUTES).forEach((route) => {
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
 * Finds a route by its path.
 * @param path - The path to search for.
 * @returns The route info or undefined if not found.
 */
export const getRouteByPath = (path: string): RouteInfo | undefined => {
  return Object.values(ROUTES).find((route) => route.path === path)
}

/**
 * Generates breadcrumb items for the current path.
 * @param path - The current path.
 * @returns An array of breadcrumb items with title and path.
 */
export const getBreadcrumbs = (path: string): Array<{ title: string; path: string }> => {
  const breadcrumbs: Array<{ title: string; path: string }> = [{ title: 'Start', path: '/' }]

  if (path !== '/') {
    // Split path into segments
    const segments = path.split('/').filter(Boolean)
    let currentPath = ''

    segments.forEach((segment) => {
      currentPath += `/${segment}`
      const route = getRouteByPath(currentPath)

      if (route) {
        breadcrumbs.push({
          title: route.breadcrumb || route.title.replace(/[^\w\s]/g, '').trim(),
          path: route.path
        })
      }
    })
  }

  return breadcrumbs
}
