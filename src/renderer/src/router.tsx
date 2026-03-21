import { createRouter, createRootRoute, createRoute } from '@tanstack/react-router'
import { createHashHistory } from '@tanstack/react-router'
import RootLayout from '@/components/layout/root-layout'
import App from '@/App'
import Calendar from '@/pages/CalendarPage'
import BandPage from '@/pages/BandPage'
import PersonPage from '@/pages/PersonPage'
import CompanyPage from '@/pages/CompanyPage'
import BankPage from '@/pages/BankPage'
import EventPage from '@/pages/EventPage'
import EventHubPage from '@/pages/EventHubPage'
import VenuePage from '@/pages/VenuePage'
import HotelPage from '@/pages/HotelPage'
import PersonRelationsPage from '@/pages/PersonRelationsPage'
import { ROUTES } from '@/lib/routing'

const hashHistory = createHashHistory()

const rootRoute = createRootRoute({
  component: () => <RootLayout />
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTES.dashboard.path,
  component: App
})

const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTES.calendar.path,
  component: Calendar
})

const bandRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTES.bands.path,
  component: BandPage
})

const personRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTES.persons.path,
  component: PersonPage
})

const personRelationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/persons/$personId/relations',
  component: PersonRelationsPage
})

const companyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTES.companies.path,
  component: CompanyPage
})

const bankRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTES.banks.path,
  component: BankPage
})

const venueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTES.venues.path,
  component: VenuePage
})

const hotelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTES.hotels.path,
  component: HotelPage
})

const eventRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTES.events.path,
  component: EventPage
})

const eventHubRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/$eventId',
  component: EventHubPage
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  calendarRoute,
  bandRoute,
  personRoute,
  personRelationsRoute,
  companyRoute,
  bankRoute,
  venueRoute,
  hotelRoute,
  eventRoute,
  eventHubRoute
])

export const router = createRouter({
  routeTree,
  history: hashHistory,
  defaultPreload: 'intent'
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
