import { useNavigate } from '@tanstack/react-router'
import { Copy, FileDown, Mail } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { useExportToast } from '@/components/export/useExportToast'
import { requestBccCompose } from '@/components/mail/pendingCompose'
import { readingActions } from '@/components/mail/readingActions'
import { addresses } from '@/components/contact-list/contactListState'
import type { ContactListSource } from '../../../../main/api/schemas/contactList.schema'

/** Copy, CSV export and a new mail with the list in BCC (the table's toolbar) */
export function ContactListSendActions({
  source,
  name,
  empty
}: {
  source: ContactListSource
  /** The saved list's name for the CSV file, '' for an unsaved list */
  name: string
  empty: boolean
}) {
  const utils = trpcReact.useUtils()
  const navigate = useNavigate()
  const exportToast = useExportToast()

  // #136: a new mail in bookingum's own editor, the list in BCC (components/mail/pendingCompose.ts)
  const writeEmail = trpcReact.contactList.writeEmail.useMutation({
    onSuccess: async ({ emails }) => {
      if (emails.length === 0) {
        toast.info('Der Verteiler hat keine Adressen.')
        return
      }
      const accounts = await utils.mail.accounts.list.fetch()
      if (!accounts.some((account) => readingActions(account).canWrite)) {
        toast.error('Zum Senden zuerst ein E-Mail-Konto hinzufügen.', {
          action: {
            label: 'Einstellungen öffnen',
            onClick: () => void navigate({ to: '/settings', search: { tab: 'email' } })
          }
        })
        return
      }
      requestBccCompose(emails)
      await navigate({ to: '/mail' })
      toast.success(`E-Mail mit ${addresses(emails.length)} in BCC geöffnet`)
    },
    onError: (error) =>
      toast.error('E-Mail konnte nicht geöffnet werden', { description: error.message })
  })

  const copyAddresses = trpcReact.contactList.copyAddresses.useMutation({
    onSuccess: ({ count }) => toast.success(`${addresses(count)} kopiert`),
    onError: (error) => toast.error('Kopieren fehlgeschlagen', { description: error.message })
  })

  const exportCsv = trpcReact.dataExport.exportContactList.useMutation({
    onSuccess: exportToast,
    onError: (error) => toast.error('Export fehlgeschlagen', { description: error.message })
  })

  const busy = writeEmail.isLoading || copyAddresses.isLoading || exportCsv.isLoading

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        disabled={empty || busy}
        onClick={() => copyAddresses.mutate(source)}
      >
        <Copy className="h-4 w-4" />
        Adressen kopieren
      </Button>
      <Button
        variant="outline"
        disabled={empty || busy}
        onClick={() => exportCsv.mutate({ source, name })}
      >
        <FileDown className="h-4 w-4" />
        CSV exportieren
      </Button>
      <Button disabled={empty || busy} onClick={() => writeEmail.mutate(source)}>
        <Mail className="h-4 w-4" />
        E-Mail schreiben
      </Button>
    </div>
  )
}
