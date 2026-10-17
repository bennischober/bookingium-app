import { createRouter, createRootRoute, createRoute, Outlet } from '@tanstack/react-router'
import { createHashHistory } from '@tanstack/react-router'
import RootLayout from '@/components/layout/root-layout'
import DashboardPage from '@/pages/DashboardPage'
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
import InvoicePage from '@/pages/InvoicePage'
import InvoicePrintPage from '@/pages/InvoicePrintPage'
import ContractPrintPage from '@/pages/ContractPrintPage'
import { ROUTES } from '@/lib/routing'
import { isEventTab, type EventTab } from '@/components/event-hub/constants'

const hashHistory = createHashHistory()

// The root route is a pass-through. App chrome (sidebar, header) lives in the
// pathless `_app` layout route so that chrome-free routes (e.g. invoice print)
// can opt out of it.
const rootRoute = createRootRoute()

const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_app',
  component: RootLayout
})

const indexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: ROUTES.dashboard.path,
  component: DashboardPage
})

const calendarRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: ROUTES.calendar.path,
  component: Calendar
})

const bandRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: ROUTES.bands.path,
  component: BandPage
})

const personRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: ROUTES.persons.path,
  component: PersonPage
})

const personRelationsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/persons/$personId/relations',
  component: PersonRelationsPage
})

const companyRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: ROUTES.companies.path,
  component: CompanyPage
})

const bankRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: ROUTES.banks.path,
  component: BankPage
})

const venueRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: ROUTES.venues.path,
  component: VenuePage
})

const hotelRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: ROUTES.hotels.path,
  component: HotelPage
})

const eventRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: ROUTES.events.path,
  component: EventPage
})

const invoiceRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: ROUTES.invoices.path,
  component: InvoicePage
})

const eventHubRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/events/$eventId',
  // The active tab lives in the URL, so returning from a print page (or any
  // back navigation) reopens the tab the user was on
  validateSearch: (search: Record<string, unknown>): { tab?: EventTab } => ({
    tab: isEventTab(search.tab) ? search.tab : undefined
  }),
  component: EventHubPage
})

// Chrome-free layout for print views (PDF output must not contain app UI)
const printLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_print',
  component: () => <Outlet />
})

const invoicePrintRoute = createRoute({
  getParentRoute: () => printLayoutRoute,
  path: '/invoices/$invoiceId/print',
  component: InvoicePrintPage
})

const contractPrintRoute = createRoute({
  getParentRoute: () => printLayoutRoute,
  path: '/events/$eventId/contract/print',
  component: ContractPrintPage
})

const routeTree = rootRoute.addChildren([
  appLayoutRoute.addChildren([
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
    invoiceRoute,
    eventHubRoute
  ]),
  printLayoutRoute.addChildren([invoicePrintRoute, contractPrintRoute])
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
