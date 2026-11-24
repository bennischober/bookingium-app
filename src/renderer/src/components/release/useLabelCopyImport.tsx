import { useState } from 'react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { LabelCopyImportDialog } from './LabelCopyImportDialog'
import type { LabelCopyPlanDto } from '../../../../main/api/schemas/release_import.schema'
import { t } from '../../../../main/i18n/translate'

/**
 * #289: "Labelcopy einlesen": picks the file, reads it and opens the preview. Give a
 * `releaseId` to read it into that release; without, the release is found by its codes.
 */
export function useLabelCopyImport({
  releaseId,
  defaultBandId = null
}: { releaseId?: number; defaultBandId?: number | null } = {}) {
  const [open, setOpen] = useState<{ path: string; plan: LabelCopyPlanDto } | null>(null)
  const plan = trpcReact.release.planLabelCopy.useMutation({
    onError: (error) => toast.error(t('Labelcopy nicht gelesen'), { description: error.message })
  })

  const start = async (droppedPath?: string) => {
    const path = droppedPath ?? (await window.api.pickLabelCopyFile())
    if (!path) return
    plan.mutate({ path, releaseId }, { onSuccess: (result) => setOpen({ path, plan: result }) })
  }

  const dialog = open ? (
    <LabelCopyImportDialog
      key={open.path}
      path={open.path}
      initialPlan={open.plan}
      defaultBandId={defaultBandId}
      onClose={() => setOpen(null)}
    />
  ) : null

  return { start: () => void start(), reading: plan.isPending, dialog }
}
