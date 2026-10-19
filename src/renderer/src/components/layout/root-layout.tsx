import { AppSidebar } from '@/components/app-sidebar'
import { AppBreadcrumbs } from '@/components/layout/app-breadcrumbs'
import { HistoryNav } from '@/components/layout/history-nav'
import { QuickCreateMenu } from '@/components/layout/quick-create-menu'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Outlet } from '@tanstack/react-router'
import SearchButton from '@/components/ui/search-command-button'
import { ShortcutsHelp } from '@/components/ShortcutsHelp'
import { ThemeToggle } from '@/components/ui/theme-toggle'

export default function RootLayout() {
  return (
    // Fixed frame (window height): only the content area scrolls, so list
    // pages can pin their toolbar, column headers and status line
    <SidebarProvider defaultOpen={true} className="h-svh overflow-hidden">
      {/* Fixed-width sidebar; the content column may shrink below its
          content's width (min-w-0), so wide tables scroll inside their own
          frame instead of widening the window and squeezing the sidebar */}
      <AppSidebar collapsible="none" className="shrink-0" />
      <SidebarInset className="min-h-0 min-w-0">
        <header className="flex h-16 shrink-0 items-center gap-4 border-b px-4">
          <div className="flex min-w-0 items-center gap-2">
            <HistoryNav />
            <AppBreadcrumbs />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <QuickCreateMenu />
            <SearchButton />
            <ShortcutsHelp />
            <ThemeToggle />
          </div>
        </header>
        <div className="flex min-h-0 min-w-0 flex-1 overflow-auto" data-testid="content-scroll">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
