import { useState } from 'react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { LabelCopyImportDialog } from './LabelCopyImportDialog'
import type {
  LabelCopyOrigin,
  LabelCopyPlanDto
} from '../../../../main/api/schemas/release_import.schema'
import { t } from '../../../../main/i18n/translate'

/** Tells two origins apart, to give each preview its own dialog state */
const originKey = (origin: LabelCopyOrigin) =>
  origin.kind === 'file' ? origin.path : `${origin.accountId}:${origin.messageId}:${origin.partId}`

/**
 * #289: "Labelcopy einlesen": picks the file (or takes a mail attachment), reads it and opens
 * the preview. Give a `releaseId` to read it into that release; without, the release is found
 * by its codes. `openRelease: false` stays where it is after the import (the mail).
 */
export function useLabelCopyImport({
  releaseId,
  defaultBandId = null,
  openRelease = true
}: { releaseId?: number; defaultBandId?: number | null; openRelease?: boolean } = {}) {
  const [open, setOpen] = useState<{ source: LabelCopyOrigin; plan: LabelCopyPlanDto } | null>(null)
  const plan = trpcReact.release.planLabelCopy.useMutation({
    onError: (error) => toast.error(t('Labelcopy nicht gelesen'), { description: error.message })
  })

  const read = (source: LabelCopyOrigin) =>
    plan.mutate({ source, releaseId }, { onSuccess: (result) => setOpen({ source, plan: result }) })

  const pick = async () => {
    const path = await window.api.pickLabelCopyFile()
    if (path) read({ kind: 'file', path })
  }

  const dialog = open ? (
    <LabelCopyImportDialog
      key={originKey(open.source)}
      source={open.source}
      initialPlan={open.plan}
      defaultBandId={defaultBandId}
      openRelease={openRelease}
      onClose={() => setOpen(null)}
    />
  ) : null

  return { start: () => void pick(), read, reading: plan.isPending, dialog }
}
