import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { readingActions } from '@/components/mail/readingActions'

/**
 * "Per E-Mail senden" (Einstellungen › E-Mail): the account invoices, reminders, dunning
 * letters and contracts are sent from. #136: always bookingum's own compose window, the
 * mail program setting is gone; the texts are in the E-Mail-Vorlagen card.
 */
export function InvoiceEmailCard() {
  const utils = trpcReact.useUtils()
  const settings = trpcReact.settings.get.useQuery()

  const updateSettings = trpcReact.settings.update.useMutation({
    onSuccess: (saved) => {
      utils.settings.get.setData(undefined, saved)
      toast.success('Einstellung gespeichert')
    },
    onError: (error) =>
      toast.error('Einstellung konnte nicht gespeichert werden', { description: error.message })
  })

  // I7 (MR-12): the account is chosen here, never guessed - only accounts that may send
  const mailAccounts = trpcReact.mail.accounts.list.useQuery()
  const sendingAccounts = (mailAccounts.data ?? []).filter(
    (account) => readingActions(account).canWrite
  )
  const invoiceMailAccountId = settings.data?.invoiceMailAccountId ?? ''
  const disabled = settings.isLoading || updateSettings.isPending

  return (
    <Card>
      <CardHeader>
        <CardTitle>Per E-Mail senden</CardTitle>
        <CardDescription>
          „Per E-Mail senden“ auf Rechnungen, Zahlungserinnerungen, Mahnungen und Verträgen öffnet
          die E-Mail mit dem PDF im Anhang. Sie prüfen und senden sie in Bookingium; eine gesendete
          Rechnung gilt danach als versendet.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="max-w-sm space-y-2">
          <Label htmlFor="settings-invoice-mail-account">Senden von</Label>
          <Select
            value={
              sendingAccounts.some((account) => account.id === invoiceMailAccountId)
                ? invoiceMailAccountId
                : ''
            }
            onValueChange={(value) => updateSettings.mutate({ invoiceMailAccountId: value })}
            disabled={disabled || sendingAccounts.length === 0}
          >
            <SelectTrigger id="settings-invoice-mail-account">
              <SelectValue placeholder="Konto wählen" />
            </SelectTrigger>
            <SelectContent>
              {sendingAccounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {mailAccounts.isSuccess && sendingAccounts.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Noch kein E-Mail-Konto, das senden kann – unten unter „E-Mail-Konten“ hinzufügen.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
