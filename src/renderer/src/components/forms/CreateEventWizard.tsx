import { useState } from 'react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useFollowUpNudge } from '@/hooks/useFollowUpNudge'
import { WizardStepIndicator } from '@/components/event-wizard/WizardStepIndicator'
import { EventBasicsStep } from '@/components/event-wizard/EventBasicsStep'
import { EventLoProStep } from '@/components/event-wizard/EventLoProStep'
import { EventDealStep } from '@/components/event-wizard/EventDealStep'
import {
  EMPTY_WIZARD_FORM,
  LAST_WIZARD_STEP,
  isEventBasicsValid,
  openedForm,
  wizardPayload,
  withCreatedItem,
  type SetWizardField,
  type WizardFormData,
  type WizardPrefill
} from '@/components/event-wizard/wizardState'
import { BandQuickCreateDialog } from '@/components/quick-create/BandQuickCreateDialog'
import { VenueQuickCreateDialog } from '@/components/quick-create/VenueQuickCreateDialog'
import { PersonQuickCreateDialog } from '@/components/quick-create/PersonQuickCreateDialog'
import { personFromSearch, type PersonPrefill } from '@/components/quick-create/personPrefill'
import type { DealMemoListItemDto } from 'src/main/api/schemas/deal_memo.schema'

interface CreateEventWizardProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (memo: DealMemoListItemDto) => void
  /** yyyy-MM-dd prefilled as the event date when the wizard opens */
  initialDate?: string
  /** #122: what the wizard opens with, read from a mail */
  prefill?: WizardPrefill
  /** #122: a sender nobody stored, offered as the LoPro person in step 2 */
  newPersonPrefill?: PersonPrefill
  /** Replaces the dialog's description */
  description?: string
}

/**
 * A new event in three steps: event & band (required), LoPro and deal details
 * (both optional). Bands, venues and persons can be created on the way. The
 * steps are rendered one at a time, so all form state lives here.
 */
export function CreateEventWizard({
  isOpen,
  onClose,
  onSuccess,
  initialDate,
  prefill,
  newPersonPrefill,
  description
}: CreateEventWizardProps) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<WizardFormData>(EMPTY_WIZARD_FORM)

  // Prefill each time the wizard opens (state adjustment during render, per "You Might
  // Not Need an Effect"). Starting from "closed" also covers a wizard mounted open.
  const [wasOpen, setWasOpen] = useState(false)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) setForm((prev) => openedForm(prev, initialDate, prefill))
  }

  // Quick-create state
  const [bandQC, setBandQC] = useState({ open: false, prefill: '' })
  const [venueQC, setVenueQC] = useState({ open: false, prefill: '' })
  const [personQC, setPersonQC] = useState<{ open: boolean; prefill: PersonPrefill }>({
    open: false,
    prefill: personFromSearch('')
  })

  // Combobox item labels (tracked after JiT create for display)
  const [bandLabel, setBandLabel] = useState<string | null>(null)
  const [venueLabel, setVenueLabel] = useState<string | null>(null)
  const [personLabel, setPersonLabel] = useState<string | null>(null)

  const bands = trpcReact.band.getListItems.useQuery()
  const venues = trpcReact.venue.getListItems.useQuery()
  const persons = trpcReact.person.getListItems.useQuery()
  const companies = trpcReact.company.getListItems.useQuery()

  const utils = trpcReact.useUtils()

  const nudgeFollowUp = useFollowUpNudge()

  const createMemo = trpcReact.dealMemo.create.useMutation({
    onSuccess: (memo) => {
      if (memo.status === 'pending') {
        // Not confirmed yet: offer a reminder to follow up on it
        void nudgeFollowUp(`Event "${memo.name}" erstellt`, {
          record: { type: 'event', id: memo.id, name: memo.name },
          note: 'Zusage einholen'
        })
      } else {
        toast.success('Event erstellt', { description: `"${form.name}" wurde hinzugefügt.` })
      }
      utils.dealMemo.getAllPaginated.invalidate()
      handleClose()
      onSuccess(memo as unknown as DealMemoListItemDto)
    },
    onError: (e) => toast.error('Event konnte nicht erstellt werden', { description: e.message })
  })

  const handleClose = () => {
    setStep(1)
    setForm(EMPTY_WIZARD_FORM)
    setBandLabel(null)
    setVenueLabel(null)
    setPersonLabel(null)
    onClose()
  }

  const set: SetWizardField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const step1Valid = isEventBasicsValid(form)

  const handleSubmit = () => {
    if (!step1Valid) return
    createMemo.mutate(wizardPayload(form))
  }

  const bandItems = withCreatedItem(
    (bands.data ?? []).map((b) => ({ id: b.id, label: b.name })),
    form.bandId,
    bandLabel
  )
  const venueItems = withCreatedItem(
    (venues.data ?? []).map((v) => ({ id: v.id, label: v.name })),
    form.venueId,
    venueLabel
  )
  const personItems = withCreatedItem(
    (persons.data ?? []).map((p) => ({ id: p.id, label: `${p.firstName} ${p.lastName}` })),
    form.loProPersonId,
    personLabel
  )
  const companyItems = (companies.data ?? []).map((c) => ({ id: c.id, label: c.name }))

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Neues Event anlegen</DialogTitle>
            <DialogDescription>
              {description ??
                'Füllen Sie die erforderlichen Felder aus. Optionale Schritte können später ergänzt werden.'}
            </DialogDescription>
          </DialogHeader>

          <WizardStepIndicator current={step} />

          {step === 1 && (
            <EventBasicsStep
              form={form}
              set={set}
              bandItems={bandItems}
              bandsLoading={bands.isLoading}
              onCreateBand={(q) => setBandQC({ open: true, prefill: q })}
              venueItems={venueItems}
              venuesLoading={venues.isLoading}
              onCreateVenue={(q) => setVenueQC({ open: true, prefill: q })}
            />
          )}

          {step === 2 && (
            <EventLoProStep
              form={form}
              set={set}
              personItems={personItems}
              personsLoading={persons.isLoading}
              onCreatePerson={(q) => setPersonQC({ open: true, prefill: personFromSearch(q) })}
              onCreateSenderPerson={
                newPersonPrefill
                  ? () => setPersonQC({ open: true, prefill: newPersonPrefill })
                  : undefined
              }
              companyItems={companyItems}
              companiesLoading={companies.isLoading}
            />
          )}

          {step === 3 && <EventDealStep form={form} set={set} />}

          <DialogFooter className="mt-2 flex items-center justify-between sm:justify-between">
            <div className="flex gap-2">
              {step > 1 && (
                <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>
                  Zurück
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {step < LAST_WIZARD_STEP && (
                <>
                  {step > 1 && (
                    <Button type="button" variant="outline" onClick={() => setStep(step + 1)}>
                      Überspringen
                    </Button>
                  )}
                  <Button
                    type="button"
                    onClick={() => setStep(step + 1)}
                    disabled={step === 1 && !step1Valid}
                  >
                    Weiter
                  </Button>
                </>
              )}
              {step === LAST_WIZARD_STEP && (
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!step1Valid || createMemo.isPending}
                >
                  {createMemo.isPending ? 'Wird erstellt…' : 'Event anlegen'}
                </Button>
              )}
              {step === 1 && step1Valid && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSubmit}
                  disabled={createMemo.isPending}
                >
                  {createMemo.isPending ? 'Wird erstellt…' : 'Schnell anlegen'}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── JiT quick-create dialogs ── */}
      <BandQuickCreateDialog
        isOpen={bandQC.open}
        prefillName={bandQC.prefill}
        onClose={() => setBandQC({ open: false, prefill: '' })}
        onCreated={(id, name) => {
          set('bandId', id)
          setBandLabel(name)
          utils.band.getListItems.invalidate()
        }}
      />

      <VenueQuickCreateDialog
        isOpen={venueQC.open}
        prefillName={venueQC.prefill}
        onClose={() => setVenueQC({ open: false, prefill: '' })}
        onCreated={(id, name) => {
          set('venueId', id)
          setVenueLabel(name)
          utils.venue.getListItems.invalidate()
        }}
      />

      {personQC.open && (
        <PersonQuickCreateDialog
          isOpen
          prefill={personQC.prefill}
          onClose={() => setPersonQC({ open: false, prefill: personFromSearch('') })}
          onCreated={(id, label) => {
            set('loProPersonId', id)
            setPersonLabel(label)
            utils.person.getListItems.invalidate()
          }}
        />
      )}
    </>
  )
}
