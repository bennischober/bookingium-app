import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { FormSheet } from '@/components/form-sheet'
import { PersonForm } from '@/components/forms/PersonForm'
import { contactPrefillFromSender } from './senderContact'
import { t } from '../../../../main/i18n/translate'

/**
 * "Kontakt anlegen": a new person from a mail's sender, with the name and address
 * filled in. Saving it starts a linking run over all mail (the contact gained an
 * address), so this mail and the sender's others are linked to the person afterwards.
 */
export function CreateContactSheet({
  open,
  onOpenChange,
  sender
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sender: { name: string; email: string }
}) {
  const utils = trpcReact.useUtils()
  const create = trpcReact.person.create.useMutation({
    onSuccess: () => {
      void utils.person.invalidate()
      onOpenChange(false)
      toast.success(t('Kontakt angelegt'), {
        description: t('Die Mails dieser Adresse werden der Person gleich zugeordnet.')
      })
    },
    onError: (error) =>
      toast.error(t('Kontakt konnte nicht angelegt werden'), { description: error.message })
  })

  return (
    <FormSheet
      isOpen={open}
      onClose={() => onOpenChange(false)}
      mode="create"
      title={t('Kontakt anlegen')}
      description={t('Eine neue Person mit der Adresse des Absenders.')}
    >
      <PersonForm
        prefill={contactPrefillFromSender(sender)}
        onSubmit={(data) => create.mutate(data)}
        onCancel={() => onOpenChange(false)}
      />
    </FormSheet>
  )
}
