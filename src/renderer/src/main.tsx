import './assets/index.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { trpcClient, trpcReact } from './lib/trpc'
import { router } from './router'
import { ThemeProvider } from './components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { ConfirmDialogHost } from '@/components/ConfirmDialogHost'
import { FolderNameDialogHost } from '@/components/mail/FolderNameDialogHost'
import { FollowUpDialogHost } from '@/components/follow-ups/FollowUpDialogHost'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Local-first single-user app: data only changes through this app
      // itself, so there is no reason to refetch aggressively.
      // - staleTime: cached data is considered fresh for a minute; visiting
      //   a page back and forth no longer re-runs every query
      // - refetchOnWindowFocus: false — clicking into the window does not
      //   refetch everything (the default was the main "slow dashboard"
      //   culprit alongside staleTime 0)
      // - retry: 1 — a failed query retries once quickly instead of three
      //   backoff-stretched attempts (the earlier "long loading" on errors)
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1
    }
  }
})
function AppRoot() {
  return (
    <React.StrictMode>
      <trpcReact.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <RouterProvider router={router} />
            <Toaster />
            <ConfirmDialogHost />
            <FolderNameDialogHost />
            <FollowUpDialogHost />
          </ThemeProvider>
        </QueryClientProvider>
      </trpcReact.Provider>
    </React.StrictMode>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<AppRoot />)
