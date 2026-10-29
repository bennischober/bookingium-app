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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import { getGroupedRoutes, getRouteShortcut, isRouteActive, ROUTES } from '@/lib/routing'
import { useRouteShown } from '@/hooks/useRouteShown'
import { useMailUnreadCount } from '@/hooks/useMailUnreadCount'
import { unreadBadgeLabel, unreadBadgeTitle } from '@/components/mail/unreadBadge'
import { countDue } from '@/lib/followUps'
import { trpcReact } from '@/lib/trpc'
import { cn } from '@/lib/utils'
// The app icon's source, so the sidebar always shows the same mark
import logoUrl from '../../../../build/icon.svg'

/** `collapsed`: only the icons, each named in its tooltip */
export function AppSidebar({
  collapsed = false,
  className,
  ...props
}: React.ComponentProps<typeof Sidebar> & { collapsed?: boolean }) {
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname
  const routeShown = useRouteShown()
  const navGroups = getGroupedRoutes((route) => routeShown(route.path))
  // Follow-ups due today or overdue, as a count on the Dashboard item
  const followUps = trpcReact.followUp.listOpen.useQuery()
  const dueCount = countDue(followUps.data ?? [])
  // Unread mail in every account's INBOX, on the E-Mail item (only while the mail client is on)
  const unreadMail = useMailUnreadCount()

  return (
    <Sidebar
      variant="sidebar"
      role="navigation"
      aria-label="Hauptnavigation"
      data-collapsed={collapsed || undefined}
      className={cn(collapsed && 'w-14', className)}
      {...props}
    >
      {/* Same height and bottom border as the top bar, so both line up */}
      <SidebarHeader
        className={cn(
          'h-16 shrink-0 justify-center border-b',
          collapsed ? 'items-center px-0' : 'px-4'
        )}
      >
        <Link
          to="/"
          className="flex w-fit items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Zum Dashboard"
        >
          <img src={logoUrl} alt="" className="size-7" />
          <h1 className={cn('text-lg font-bold', collapsed && 'sr-only')}>Bookingium</h1>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.title} className={cn(collapsed && 'px-2')}>
            {collapsed ? (
              <h2 className="sr-only">{group.title}</h2>
            ) : (
              <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const shortcut = getRouteShortcut(item.path)
                  const keys = shortcut ? `Alt+${shortcut}` : undefined
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        asChild
                        isActive={isRouteActive(item.path, currentPath)}
                        title={collapsed ? (keys ? `${item.title} (${keys})` : item.title) : keys}
                        className={cn(collapsed && 'justify-center')}
                      >
                        <Link to={item.path}>
                          <item.icon />
                          <span className={cn(collapsed && 'sr-only')}>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                      {item.path === '/' && dueCount > 0 && (
                        <SidebarMenuBadge
                          title={`${dueCount} ${dueCount === 1 ? 'Wiedervorlage' : 'Wiedervorlagen'} fällig`}
                          className={cn(
                            'bg-primary/15 text-primary',
                            collapsed &&
                              'top-0 right-0 h-4 min-w-4 bg-primary text-[10px] text-primary-foreground'
                          )}
                        >
                          {dueCount}
                          <span className="sr-only"> Wiedervorlagen fällig</span>
                        </SidebarMenuBadge>
                      )}
                      {item.path === ROUTES.mail.path && unreadMail.total > 0 && (
                        <SidebarMenuBadge
                          title={unreadBadgeTitle(unreadMail.accounts)}
                          className={cn(
                            'bg-primary/15 text-primary',
                            collapsed &&
                              'top-0 right-0 h-4 min-w-4 bg-primary text-[10px] text-primary-foreground'
                          )}
                        >
                          {unreadBadgeLabel(unreadMail.total)}
                          <span className="sr-only"> ungelesen im Posteingang</span>
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  )
}
