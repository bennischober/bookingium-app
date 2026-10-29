import { trpcReact } from '@/lib/trpc'
import { ROUTES } from '@/lib/routing'

/**
 * Whether a page belongs in the menu and the search: the pages behind an experimental switch
 * ("E-Mail", "Verteiler") only while it is on, and not while the settings load. Their routes
 * stay reachable and show a note pointing to the switch. Anything without a path is shown.
 */
export function useRouteShown(): (path: string | undefined) => boolean {
  const settings = trpcReact.settings.get.useQuery().data
  return (path) => {
    if (path === ROUTES.mail.path) return settings?.mailClient === true
    if (path === ROUTES.contactLists.path) return settings?.contactLists === true
    return true
  }
}
