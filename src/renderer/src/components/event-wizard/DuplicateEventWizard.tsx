import { useNavigate } from '@tanstack/react-router'
import { trpcReact } from '@/lib/trpc'
import { CreateEventWizard } from '@/components/forms/CreateEventWizard'
import { duplicateOf } from './duplicateEvent'
import { t } from '../../../../main/i18n/translate'

/**
 * #199 "Event duplizieren": the event wizard, opened with what the event `sourceId` shares with a
 * new date of it (band, deal, LoPro, prices, notes, tour, invoicing). The date and the club /
 * festival are asked for again. The new event opens once created.
 */
export function DuplicateEventWizard({
  sourceId,
  onClose
}: {
  /** The event to duplicate; null while none is picked */
  sourceId: number | null
  onClose: () => void
}) {
  const navigate = useNavigate()
  const source = trpcReact.dealMemo.getById.useQuery(sourceId ?? 0, {
    enabled: sourceId !== null
  })
  // Opens once the source is loaded, so the wizard starts with its fields
  const ready = sourceId !== null && source.data?.id === sourceId
  const duplicate = ready && source.data ? duplicateOf(source.data) : null

  return (
    <CreateEventWizard
      isOpen={ready}
      onClose={onClose}
      title={t('Event duplizieren')}
      description={t(
        'Band, Deal, LoPro, Preise und Notizen sind übernommen. Datum und Club / Festival bitte neu wählen.'
      )}
      prefill={duplicate?.prefill}
      carry={duplicate?.carry}
      onSuccess={(memo) => {
        onClose()
        void navigate({ to: '/events/$eventId', params: { eventId: String(memo.id) } })
      }}
    />
  )
}
