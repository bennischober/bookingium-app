// #61: the event wizard's form state and rules, out of the component.

import type { ComboboxItem } from '@/components/ui/entity-combobox'

export interface WizardFormData {
  // Step 1
  name: string
  date: string
  bandId: number | null
  venueId: number | null
  // Step 2
  loProPersonId: number | null
  loProCompanyId: number | null
  // Step 3
  deal: string
  status: string
  ticketPriceVvk: string
  ticketPriceAk: string
  notes: string
}

/** What the wizard can open with, e.g. read from a mail (#122) or an event to duplicate (#199) */
export type WizardPrefill = Partial<WizardFormData>

/**
 * #199: fields of a duplicated event the wizard does not show; they go into the new event as
 * they are and can be changed on its page afterwards
 */
export interface WizardCarry {
  invoiceCompanyId: number | null
  representingCompanyId: number | null
  guaranteeAmount: number | null
  guaranteeVatRate: number | null
  contractNotes: string
  tour: string
}

export const WIZARD_STEPS = [
  { label: 'Event & Band', required: true },
  { label: 'LoPro', required: false },
  { label: 'Deal-Details', required: false }
]

export const LAST_WIZARD_STEP = WIZARD_STEPS.length

export const EMPTY_WIZARD_FORM: WizardFormData = {
  name: '',
  date: '',
  bandId: null,
  venueId: null,
  loProPersonId: null,
  loProCompanyId: null,
  deal: '',
  status: 'pending',
  ticketPriceVvk: '',
  ticketPriceAk: '',
  notes: ''
}

/** The form as the wizard opens: the open date and the prefill over what it holds */
export const openedForm = (
  form: WizardFormData,
  initialDate?: string,
  prefill?: WizardPrefill
): WizardFormData =>
  initialDate || prefill
    ? { ...form, ...(initialDate ? { date: initialDate } : {}), ...prefill }
    : form

/** Step 1 holds everything an event needs; the later steps are optional */
export const isEventBasicsValid = (form: WizardFormData): boolean =>
  form.name.trim() !== '' && form.date !== '' && form.bandId !== null

/** A yyyy-MM-dd date, the only kind the agency-booking check runs on */
export const isIsoDate = (date: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(date)

/** The `dealMemo.create` input; call only once `isEventBasicsValid` holds */
export const wizardPayload = (form: WizardFormData, carry?: WizardCarry) => ({
  ...carry,
  name: form.name.trim(),
  deal: form.deal.trim() || undefined,
  date: form.date,
  bandId: form.bandId!,
  venueId: form.venueId,
  loProPersonId: form.loProPersonId,
  loProCompanyId: form.loProCompanyId,
  status: form.status,
  ticketPriceVvk: form.ticketPriceVvk ? parseFloat(form.ticketPriceVvk) : null,
  ticketPriceAk: form.ticketPriceAk ? parseFloat(form.ticketPriceAk) : null,
  notes: form.notes
})

/**
 * The combobox items, plus a record created just now that the list query does
 * not have yet, so the selection shows its name until the list refetches.
 */
export const withCreatedItem = (
  items: ComboboxItem[],
  selectedId: number | null,
  createdLabel: string | null
): ComboboxItem[] =>
  createdLabel && selectedId && !items.some((item) => item.id === selectedId)
    ? [...items, { id: selectedId, label: createdLabel }]
    : items

/** Sets one field of the wizard form; the steps get it from the wizard */
export type SetWizardField = <K extends keyof WizardFormData>(
  key: K,
  value: WizardFormData[K]
) => void
