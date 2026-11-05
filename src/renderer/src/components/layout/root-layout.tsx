import { AppSidebar } from '@/components/app-sidebar'
import { AppBreadcrumbs } from '@/components/layout/app-breadcrumbs'
import { HistoryNav } from '@/components/layout/history-nav'
import { QuickCreateMenu } from '@/components/layout/quick-create-menu'
import { SidebarToggle } from '@/components/layout/sidebar-toggle'
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
import { Mail } from 'lucide-react'
import { toast } from '@/lib/toast'
import SearchButton from '@/components/ui/search-command-button'
import { ShortcutsHelp } from '@/components/ShortcutsHelp'

export default function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [collapsed, toggleSidebar] = useSidebarCollapsed(pathname)
  const navigate = useNavigate()
  const router = useRouter()
  // #65: "E-Mail öffnen" in the tray menu, a click on a new-mail notification (with its
  // account: the mail page then opens that account's newest unread mail)
  useEffect(
    () =>
      window.api.onOpenMailPage(
        (accountId) => void navigate({ to: '/mail', search: { newMail: accountId } })
      ),
    [navigate]
  )
  // #65: new mail while the app has focus. Not on the mail page, which lists it anyway; one
  // popup at a time (a newer one replaces it), gone after a few seconds
  useEffect(
    () =>
      window.api.onNewMail((notice) => {
        if (router.state.location.pathname.startsWith('/mail')) return
        toast.info(notice.title, {
          id: 'new-mail',
          icon: <Mail className="size-4" />,
          description: notice.body,
          duration: 6000,
          action: {
            label: 'Anzeigen',
            onClick: () => void navigate({ to: '/mail', search: { newMail: notice.accountId } })
          }
        })
      }),
    [navigate, router]
  )

  return (
    // Fixed frame (window height): only the content area scrolls, so list
    // pages can pin their toolbar, column headers and status line
    <SidebarProvider defaultOpen={true} className="h-svh overflow-hidden">
      {/* Fixed-width sidebar; the content column may shrink below its
          content's width (min-w-0), so wide tables scroll inside their own
          frame instead of widening the window and squeezing the sidebar */}
      <AppSidebar collapsible="none" collapsed={collapsed} className="shrink-0" />
      <SidebarInset className="min-h-0 min-w-0">
        <header className="flex h-16 shrink-0 items-center gap-4 border-b px-4">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarToggle collapsed={collapsed} onToggle={toggleSidebar} />
            <HistoryNav />
            <AppBreadcrumbs />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/* Most used first: search, then the main action, then help apart */}
            <SearchButton />
            <QuickCreateMenu />
            <div className="mx-1 h-6 w-px bg-border" aria-hidden />
            <ShortcutsHelp />
          </div>
        </header>
        {/* H6: the gutter is reserved HERE, on the element that actually scrolls, not on
            <html>. On <html> it cost 15px of dead space at the right of every page even
            when nothing could scroll (measured: body 869px against an 884px viewport), which
            read as a mysterious empty strip. */}
        <div
          className="flex min-h-0 min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
          data-testid="content-scroll"
        >
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
