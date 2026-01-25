import { createRouter, createRootRoute, createRoute } from '@tanstack/react-router'
import { createHashHistory } from '@tanstack/react-router'
import RootLayout from './components/root-layout'
import App from './App'

const hashHistory = createHashHistory()

const rootRoute = createRootRoute({
  component: () => <RootLayout />
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: App
})

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/about',
  component: () => <div className="p-4">About Page</div>
})

const routeTree = rootRoute.addChildren([indexRoute, aboutRoute])

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
