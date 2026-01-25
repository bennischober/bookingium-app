import './assets/index.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { createTRPCReact } from '@trpc/react-query'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { ipcLink } from 'electron-trpc/renderer'
import type { AppRouter } from '../../main/api/router'
import { router } from './router'
import { Toaster } from "@/components/ui/sonner"

export const trpcReact = createTRPCReact<AppRouter>()

const queryClient = new QueryClient()
const trpcClient = trpcReact.createClient({
  links: [ipcLink()]
})

function AppRoot() {
  return (
    <React.StrictMode>
      <trpcReact.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <Toaster />
        </QueryClientProvider>
      </trpcReact.Provider>
    </React.StrictMode>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<AppRoot />)
