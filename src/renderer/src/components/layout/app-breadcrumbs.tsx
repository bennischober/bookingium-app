import React, { useEffect } from 'react'
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
import { setCurrentPageLabel } from '@/lib/navigationHistory'

/** `name`: an entity name - the only crumbs that may shorten ("…") */
type Crumb = { title: string; path?: string; name?: boolean }

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
  if (eventId !== null) crumbs.push({ title: event.data?.name ?? '…', name: true })
  if (personId !== null) {
    crumbs.push({
      title: person.data ? `${person.data.firstName} ${person.data.lastName}` : '…',
      name: true
    })
    crumbs.push({ title: 'Beziehungen' })
  }

  // Names the page in the back/forward history once the entity name is loaded
  const label = crumbs.map((crumb) => crumb.title).join(' › ')
  const loaded = !crumbs.some((crumb) => crumb.title === '…')
  useEffect(() => {
    if (label && loaded) setCurrentPageLabel(pathname, label)
  }, [pathname, label, loaded])

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap overflow-hidden">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1
          return (
            <React.Fragment key={`${index}-${crumb.title}`}>
              {index > 0 && <BreadcrumbSeparator className="shrink-0" />}
              {/* On narrow windows entity names give way first (keeping a few
                  letters, full name as tooltip), trailing labels only as a
                  last resort; the section link always stays whole */}
              <BreadcrumbItem
                className={
                  index === 0 ? 'shrink-0' : crumb.name ? 'min-w-12 shrink-[100]' : 'min-w-0'
                }
              >
                {isLast || !crumb.path ? (
                  <BreadcrumbPage className="min-w-0 truncate" title={crumb.title}>
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
