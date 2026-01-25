/**
 * A route information object containing the path, title, and group.
 */
export type RouteInfo = {
  path: string
  title: string
  group: string
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
    group: 'Main Menu'
  },
  calendar: {
    path: '/calendar',
    title: '📅 Calendar',
    group: 'Main Menu'
  },
  events: {
    path: '/events',
    title: '🎸 Events',
    group: 'Production'
  },
  invoices: {
    path: '/invoices',
    title: '📄 Invoices',
    group: 'Production'
  },
  bands: {
    path: '/band',
    title: '🥁 Bands',
    group: 'Directory'
  },
  venues: {
    path: '/venues',
    title: '📍 Venues',
    group: 'Directory'
  },
  hotels: {
    path: '/hotels',
    title: '🏨 Hotels',
    group: 'Directory'
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
