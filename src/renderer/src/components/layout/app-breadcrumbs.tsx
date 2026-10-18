import React from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb'
import { ROUTES, isRouteActive } from '@/lib/routing'
import { trpcReact } from '@/lib/trpc'

type Crumb = { title: string; path?: string }

/**
 * Top bar breadcrumbs: the menu section, then the open entity by name on
 * detail pages (e.g. "Events › Midnight Symphony - LA Showcase"). The names
 * come from the same queries the detail pages use, so they are usually
 * already cached.
 */
export function AppBreadcrumbs() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  const eventMatch = pathname.match(/^\/events\/(\d+)/)
  const personMatch = pathname.match(/^\/persons\/(\d+)\/relations/)
  const eventId = eventMatch ? Number(eventMatch[1]) : null
  const personId = personMatch ? Number(personMatch[1]) : null

  const event = trpcReact.dealMemo.getById.useQuery(eventId ?? 0, { enabled: eventId !== null })
  const person = trpcReact.person.getById.useQuery(
    { id: personId ?? 0 },
    { enabled: personId !== null }
  )

  const crumbs: Crumb[] = []
  const section = Object.values(ROUTES).find((route) => isRouteActive(route.path, pathname))
  if (section) crumbs.push({ title: section.title, path: section.path })
  if (eventId !== null) crumbs.push({ title: event.data?.name ?? '…' })
  if (personId !== null) {
    crumbs.push({
      title: person.data ? `${person.data.firstName} ${person.data.lastName}` : '…',
      path: undefined
    })
    crumbs.push({ title: 'Beziehungen' })
  }

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1
          return (
            <React.Fragment key={`${index}-${crumb.title}`}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className="min-w-0">
                {isLast || !crumb.path ? (
                  <BreadcrumbPage className="truncate" title={crumb.title}>
                    {crumb.title}
                  </BreadcrumbPage>
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
  )
}
