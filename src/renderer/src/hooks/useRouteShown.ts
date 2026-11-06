import { trpcReact } from '@/lib/trpc'
import { ROUTES } from '@/lib/routing'

/**
 * Whether a page belongs in the menu and the search: the page behind an experimental switch
 * ("Karte") only while it is on, and not while the settings load. Its route stays reachable
 * and shows a note pointing to the switch. Anything without a path is shown.
 */
export function useRouteShown(): (path: string | undefined) => boolean {
  const settings = trpcReact.settings.get.useQuery().data
  return (path) => {
    if (path === ROUTES.map.path) return settings?.mapPreview === true
    return true
  }
}
