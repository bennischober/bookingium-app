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
import { getBreadcrumbs } from '@/lib/routing'

export default function RootLayout() {
  const routerState = useRouterState()
  const breadcrumbs = getBreadcrumbs(routerState.location.pathname)

  return (
    <SidebarProvider defaultOpen={true}>
      <AppSidebar collapsible="none" />
      <SidebarInset>
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

          <div className="ml-auto">
            <SearchButton />
          </div>
        </header>
        <div className="flex">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
