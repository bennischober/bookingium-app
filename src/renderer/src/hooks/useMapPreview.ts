import { trpcReact } from '@/lib/trpc'
import type { RadiusDefaults } from '@/components/map/radiusDisplay'

/**
 * The "Karte (experimentell)" setting and the radius clause defaults. Off (and while the
 * settings load), the renderer shows no radius fields - they only matter for the map.
 */
export function useMapPreview(): { enabled: boolean; defaults: RadiusDefaults | null } {
  const settings = trpcReact.settings.get.useQuery().data
  return {
    enabled: settings?.mapPreview === true,
    defaults: settings ? { club: settings.radiusClub, festival: settings.radiusFestival } : null
  }
}
