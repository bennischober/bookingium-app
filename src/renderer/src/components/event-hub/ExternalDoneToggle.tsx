import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { CircleCheck, Paperclip } from 'lucide-react'
import { useEventSteps } from '@/hooks/useEventSteps'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { cn, formatShortDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { EventStep } from '../../../../main/api/schemas/event_step.schema'
import { EXTERNAL_STEP_DOCUMENT_TYPES, EXTERNAL_STEP_LABELS, stepFileCount } from './externalSteps'
import { t } from '../../../../main/i18n/translate'

/**
 * A tick for a step done outside the program ("extern erledigt"), e.g. the contract signed on
 * paper. It saves at once, in view and edit mode alike, and the step leaves the open points.
 * Steps with paperwork (contract, deposit, invoice) can take the file right here.
 */
export function ExternalDoneToggle({
  eventId,
  step,
  className
}: {
  eventId: number
  step: EventStep
  className?: string
}) {
  const { done, isLoading, isSaving, set } = useEventSteps(eventId)
  const doneAt = done.get(step)
  const checked = doneAt !== undefined
  const id = `external-done-${step}`
  return (
    <div
      className={cn(
        'inline-flex flex-wrap items-center gap-2 text-sm normal-case tracking-normal',
        checked ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground',
        className
      )}
    >
      <input
        id={id}
        type="checkbox"
        className="h-4 w-4 accent-primary"
        checked={checked}
        disabled={isLoading || isSaving}
        onChange={(event) => set(step, event.target.checked)}
        title={t('{{value}}: außerhalb von Bookingium erledigt – kein offener Punkt mehr', {
          value: EXTERNAL_STEP_LABELS[step]
        })}
      />
      <label htmlFor={id} className="cursor-pointer font-normal select-none">
        {t('{{label}} extern erledigt', { label: EXTERNAL_STEP_LABELS[step] })}
      </label>
      {checked && (
        <span className="inline-flex items-center gap-1 text-xs">
          <CircleCheck className="h-3.5 w-3.5" aria-hidden />
          {formatShortDate(doneAt)}
        </span>
      )}
      {EXTERNAL_STEP_DOCUMENT_TYPES[step] && (
        <StepFiles
          eventId={eventId}
          step={step}
          onAttached={() => {
            if (!checked) set(step, true)
          }}
        />
      )}
    </div>
  )
}

/**
 * "Datei hinzufügen": the outside paperwork of a step (the signed contract, the invoice) goes
 * to the event's Dokumente tab with the matching type; the count links there.
 */
function StepFiles({
  eventId,
  step,
  onAttached
}: {
  eventId: number
  step: EventStep
  onAttached: () => void
}) {
  const navigate = useNavigate()
  const utils = trpcReact.useUtils()
  const owner = { ownerType: 'event' as const, ownerId: eventId }
  const documents = trpcReact.document.listByOwner.useQuery(owner)
  const upload = trpcReact.document.upload.useMutation()
  const [isUploading, setIsUploading] = useState(false)
  const count = stepFileCount(step, documents.data ?? [])
  const label = EXTERNAL_STEP_LABELS[step]

  const attach = async () => {
    const picked = await window.api.showOpenDialog()
    if (picked.canceled || !picked.filePaths?.length) return
    setIsUploading(true)
    let uploaded = 0
    for (const sourcePath of picked.filePaths) {
      try {
        await upload.mutateAsync({
          ...owner,
          sourcePath,
          documentType: EXTERNAL_STEP_DOCUMENT_TYPES[step]
        })
        uploaded++
      } catch (error) {
        toast.error(
          t('„{{pop}}“ konnte nicht hochgeladen werden', { pop: sourcePath.split(/[\\/]/).pop() }),
          {
            description: error instanceof Error ? error.message : undefined
          }
        )
      }
    }
    setIsUploading(false)
    void utils.document.invalidate()
    if (uploaded > 0) {
      onAttached()
      toast.success(
        uploaded === 1
          ? t('{{label}}: Datei hinzugefügt', { label })
          : t('{{label}}: {{uploaded}} Dateien hinzugefügt', { label, uploaded }),
        { description: t('Sie liegt unter „Dokumente“.') }
      )
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={isUploading}
        onClick={() => void attach()}
        aria-label={t('{{label}}: Datei hinzufügen', { label })}
        title={t(
          'Datei auswählen; sie kommt als „{{label}}“ unter „Dokumente“ und der Haken wird gesetzt',
          { label }
        )}
      >
        <Paperclip className="h-3.5 w-3.5" aria-hidden />
        {isUploading ? t('Wird hochgeladen…') : t('Datei hinzufügen')}
      </Button>
      {count > 0 && (
        <button
          type="button"
          className="text-xs underline-offset-2 hover:underline"
          onClick={() =>
            navigate({ to: '.', search: { tab: 'documents' } as never, replace: true })
          }
          title={t('Zu den Dokumenten des Events')}
        >
          {count === 1 ? t('1 Datei') : t('{{count}} Dateien', { count })}
        </button>
      )}
    </span>
  )
}
