import { createRouter, createRootRoute, createRoute } from '@tanstack/react-router'
import { createHashHistory } from '@tanstack/react-router'
import RootLayout from '@/layout/root-layout'
import App from '@/App'
import BandPage from '@/pages/BandPage'
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

const routeTree = rootRoute.addChildren([indexRoute, bandRoute])

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
