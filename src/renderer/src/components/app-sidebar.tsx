import * as React from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import { getGroupedRoutes, getRouteShortcut, isRouteActive } from '@/lib/routing'

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname
  const navGroups = getGroupedRoutes()

  return (
    <Sidebar variant="sidebar" {...props}>
      {/* Same height and bottom border as the top bar, so both line up */}
      <SidebarHeader className="h-16 shrink-0 justify-center border-b px-4">
        <h1 className="text-lg font-bold tracking-wide">BOOKINGIUM</h1>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.title}>
            <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      asChild
                      isActive={isRouteActive(item.path, currentPath)}
                      title={`Alt+${getRouteShortcut(item.path)}`}
                    >
                      <Link to={item.path}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  )
}
