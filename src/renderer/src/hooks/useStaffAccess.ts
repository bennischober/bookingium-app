import { trpcReact } from '@/lib/trpc'
import type { AccessStatusDto } from '../../../main/api/schemas/access.schema'

/**
 * #262: staff access (Mitarbeiterzugang) of this computer. `locked` hides the company-internal
 * areas (DATEV, own company and invoice settings, CSV import, backup and restore, setting up
 * the sync); the main process refuses them too. While the status loads, nothing counts as
 * locked, so a normal computer never flickers.
 */
export function useStaffAccess(): { locked: boolean; status: AccessStatusDto | undefined } {
  const status = trpcReact.access.status.useQuery(undefined, { staleTime: Infinity }).data
  return { locked: status?.locked === true, status }
}
