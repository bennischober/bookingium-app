import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { SetWizardField, WizardFormData } from '@/components/event-wizard/wizardState'
import { t } from '../../../../main/i18n/translate'

/** Step 3 (optional): status, ticket prices, notes and the deal terms */
export function EventDealStep({ form, set }: { form: WizardFormData; set: SetWizardField }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{t('Status')}</Label>
        <Select value={form.status} onValueChange={(v) => set('status', v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">{t('Ausstehend')}</SelectItem>
            <SelectItem value="confirmed">{t('Bestätigt')}</SelectItem>
            <SelectItem value="cancelled">{t('Storniert')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="vvk">{t('Ticketpreis VVK (€)')}</Label>
          <Input
            id="vvk"
            type="number"
            min="0"
            step="0.01"
            value={form.ticketPriceVvk}
            onChange={(e) => set('ticketPriceVvk', e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ak">{t('Ticketpreis AK (€)')}</Label>
          <Input
            id="ak"
            type="number"
            min="0"
            step="0.01"
            value={form.ticketPriceAk}
            onChange={(e) => set('ticketPriceAk', e.target.value)}
            placeholder="0.00"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">{t('Anmerkungen')}</Label>
        <Textarea
          id="notes"
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          rows={3}
          placeholder={t('Weitere Informationen…')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="deal-terms">{t('Deal-Bedingungen')}</Label>
        <Input
          id="deal-terms"
          value={form.deal}
          onChange={(e) => set('deal', e.target.value)}
          placeholder={t('z. B. 70/30, Pauschale 2.000 €, Garantie 1.500 € + 80 %…')}
        />
        <p className="text-xs text-muted-foreground">
          {t('Die finanzielle Aufteilung oder Vergütungsvereinbarung für diese Show (optional).')}
        </p>
      </div>
    </div>
  )
}
