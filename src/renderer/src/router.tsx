import { createRouter, createRootRoute, createRoute } from '@tanstack/react-router'
import { createHashHistory } from '@tanstack/react-router'
import RootLayout from '@/components/layout/root-layout'
import App from '@/App'
import BandPage from '@/pages/BandPage'
import PersonPage from '@/pages/PersonPage'
import CompanyPage from '@/pages/CompanyPage'
import BankPage from '@/pages/BankPage'
import EventPage from '@/pages/EventPage'
import { PersonRelationsPage } from '@/pages/PersonRelationsPage'
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

const eventRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTES.events.path,
  component: EventPage
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  bandRoute,
  personRoute,
  personRelationsRoute,
  companyRoute,
  bankRoute,
  eventRoute
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
