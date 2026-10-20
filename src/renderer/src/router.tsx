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
import BandDetailPage from '@/pages/BandDetailPage'
import SettingsPage from '@/pages/SettingsPage'
import CompanyDetailPage from '@/pages/CompanyDetailPage'
import VenueDetailPage from '@/pages/VenueDetailPage'
import VenuePage from '@/pages/VenuePage'
import HotelPage from '@/pages/HotelPage'
import PersonDetailPage from '@/pages/PersonDetailPage'
import InvoicePage from '@/pages/InvoicePage'
import InvoicePrintPage from '@/pages/InvoicePrintPage'
import ContractPrintPage from '@/pages/ContractPrintPage'
import ManagementContractPrintPage from '@/pages/ManagementContractPrintPage'
import { ROUTES } from '@/lib/routing'
import { trackNavigationHistory } from '@/lib/navigationHistory'
import { validateListSearch } from '@/hooks/useListSearchActions'
import { isEventTab, type EventTab } from '@/components/event-hub/constants'
import { isBandTab, type BandTab } from '@/components/band/constants'
import { isCompanyTab, type CompanyTab } from '@/components/company/constants'
import { isVenueTab, type VenueTab } from '@/components/venue/constants'
import { isPersonTab, type PersonTab } from '@/components/person/constants'

const hashHistory = createHashHistory()
// Back/forward buttons in the top bar
trackNavigationHistory(hashHistory)

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
  validateSearch: validateListSearch,
  component: BandPage
})

const personRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: ROUTES.persons.path,
  validateSearch: validateListSearch,
  component: PersonPage
})

const personDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/persons/$personId',
  validateSearch: (search: Record<string, unknown>): { tab?: PersonTab } => ({
    tab: isPersonTab(search.tab) ? search.tab : undefined
  }),
  component: PersonDetailPage
})

const companyRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: ROUTES.companies.path,
  validateSearch: validateListSearch,
  component: CompanyPage
})

const bankRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: ROUTES.banks.path,
  validateSearch: validateListSearch,
  component: BankPage
})

const venueRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: ROUTES.venues.path,
  validateSearch: validateListSearch,
  component: VenuePage
})

const hotelRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: ROUTES.hotels.path,
  validateSearch: validateListSearch,
  component: HotelPage
})

const eventRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: ROUTES.events.path,
  validateSearch: validateListSearch,
  component: EventPage
})

const invoiceRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: ROUTES.invoices.path,
  validateSearch: validateListSearch,
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

const bandDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/band/$bandId',
  validateSearch: (search: Record<string, unknown>): { tab?: BandTab } => ({
    tab: isBandTab(search.tab) ? search.tab : undefined
  }),
  component: BandDetailPage
})

const companyDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/companies/$companyId',
  validateSearch: (search: Record<string, unknown>): { tab?: CompanyTab } => ({
    tab: isCompanyTab(search.tab) ? search.tab : undefined
  }),
  component: CompanyDetailPage
})

const venueDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/venues/$venueId',
  validateSearch: (search: Record<string, unknown>): { tab?: VenueTab } => ({
    tab: isVenueTab(search.tab) ? search.tab : undefined
  }),
  component: VenueDetailPage
})

const settingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: ROUTES.settings.path,
  component: SettingsPage
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

const managementContractPrintRoute = createRoute({
  getParentRoute: () => printLayoutRoute,
  path: '/management-contracts/$contractId/print',
  component: ManagementContractPrintPage
})

const routeTree = rootRoute.addChildren([
  appLayoutRoute.addChildren([
    indexRoute,
    calendarRoute,
    bandRoute,
    personRoute,
    personDetailRoute,
    companyRoute,
    bankRoute,
    venueRoute,
    hotelRoute,
    eventRoute,
    invoiceRoute,
    eventHubRoute,
    bandDetailRoute,
    settingsRoute,
    companyDetailRoute,
    venueDetailRoute
  ]),
  printLayoutRoute.addChildren([
    invoicePrintRoute,
    contractPrintRoute,
    managementContractPrintRoute
  ])
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
