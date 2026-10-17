import React from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import SearchButton from '@/components/ui/search-command-button'
import { ShortcutsHelp } from '@/components/ShortcutsHelp'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { getBreadcrumbs } from '@/lib/routing'

export default function RootLayout() {
  const routerState = useRouterState()
  const breadcrumbs = getBreadcrumbs(routerState.location.pathname)

  return (
    <SidebarProvider defaultOpen={true}>
      {/* Fixed-width sidebar; the content column may shrink below its
          content's width (min-w-0), so wide tables scroll inside their own
          frame instead of widening the window and squeezing the sidebar */}
      <AppSidebar collapsible="none" className="shrink-0" />
      <SidebarInset className="min-w-0">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1

                return (
                  <React.Fragment key={crumb.path}>
                    {index > 0 && <BreadcrumbSeparator />}
                    <BreadcrumbItem>
                      {isLast ? (
                        <BreadcrumbPage>{crumb.title}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink asChild>
                          <Link to={crumb.path}>{crumb.title}</Link>
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </React.Fragment>
                )
              })}
            </BreadcrumbList>
          </Breadcrumb>

          <div className="ml-auto flex items-center gap-2">
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
