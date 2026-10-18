import { AppSidebar } from '@/components/app-sidebar'
import { AppBreadcrumbs } from '@/components/layout/app-breadcrumbs'
import { QuickCreateMenu } from '@/components/layout/quick-create-menu'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Outlet } from '@tanstack/react-router'
import SearchButton from '@/components/ui/search-command-button'
import { ShortcutsHelp } from '@/components/ShortcutsHelp'
import { ThemeToggle } from '@/components/ui/theme-toggle'

export default function RootLayout() {
  return (
    <SidebarProvider defaultOpen={true}>
      {/* Fixed-width sidebar; the content column may shrink below its
          content's width (min-w-0), so wide tables scroll inside their own
          frame instead of widening the window and squeezing the sidebar */}
      <AppSidebar collapsible="none" className="shrink-0" />
      <SidebarInset className="min-w-0">
        <header className="flex h-16 shrink-0 items-center gap-4 border-b px-4">
          <AppBreadcrumbs />

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <QuickCreateMenu />
            <SearchButton />
            <ShortcutsHelp />
            <ThemeToggle />
          </div>
        </header>
        <div className="flex min-w-0">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
