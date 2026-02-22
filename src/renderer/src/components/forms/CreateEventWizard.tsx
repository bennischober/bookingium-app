import { useState } from 'react'
import { trpcReact } from '@/main'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { EntityCombobox } from '@/components/ui/entity-combobox'
import { cn } from '@/lib/utils'
import type { DealMemoListItemDto } from 'src/main/api/schemas/deal_memo.schema'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WizardFormData {
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

interface CreateEventWizardProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (memo: DealMemoListItemDto) => void
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = [
  { label: 'Event & Band', required: true },
  { label: 'LoPro', required: false },
  { label: 'Deal Details', required: false }
]

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {STEPS.map((step, i) => {
        const num = i + 1
        const active = num === current
        const done = num < current
        return (
          <div key={num} className="flex items-center gap-2">
            {i > 0 && <div className="h-px w-6 bg-border" />}
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                  done && 'bg-primary text-primary-foreground',
                  active && 'border-2 border-primary text-primary',
                  !done && !active && 'border border-border text-muted-foreground'
                )}
              >
                {done ? '✓' : num}
              </div>
              <span
                className={cn(
                  'text-xs',
                  active ? 'font-medium' : 'text-muted-foreground',
                  !step.required && !active && 'opacity-60'
                )}
              >
                {step.label}
                {!step.required && (
                  <span className="ml-0.5 text-muted-foreground"> (opt)</span>
                )}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Band quick-create dialog ─────────────────────────────────────────────────

interface BandQuickCreateProps {
  isOpen: boolean
  prefillName: string
  onClose: () => void
  onCreated: (id: number, name: string) => void
}

function BandQuickCreateDialog({ isOpen, prefillName, onClose, onCreated }: BandQuickCreateProps) {
  const [name, setName] = useState(prefillName)
  const [genre, setGenre] = useState('')
  const [companyId, setCompanyId] = useState<number | null>(null)

  const companies = trpcReact.company.getListItems.useQuery()

  const createBand = trpcReact.band.create.useMutation({
    onSuccess: (band) => {
      toast.success(`Band "${band.name}" created`)
      onCreated(band.id, band.name)
      onClose()
    },
    onError: (e) => toast.error('Failed to create band', { description: e.message })
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || companyId === null) return
    createBand.mutate({ name: name.trim(), genre: genre.trim(), companyId })
  }

  // Keep name in sync when dialog opens with a new prefill
  if (isOpen && name !== prefillName && prefillName) {
    setName(prefillName)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Quick-add Band</DialogTitle>
          <DialogDescription>Minimal info — you can fill the rest later.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="band-name">Band Name *</Label>
            <Input
              id="band-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. The Rockettes"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="band-genre">Genre</Label>
            <Input
              id="band-genre"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              placeholder="e.g. Rock"
            />
          </div>
          <div className="space-y-2">
            <Label>Management Company *</Label>
            <EntityCombobox
              items={(companies.data ?? []).map((c) => ({ id: c.id, label: c.name }))}
              value={companyId}
              onChange={setCompanyId}
              placeholder="Select company…"
              searchPlaceholder="Search companies…"
              isLoading={companies.isLoading}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || companyId === null || createBand.isPending}>
              Create Band
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Venue quick-create dialog ────────────────────────────────────────────────

interface VenueQuickCreateProps {
  isOpen: boolean
  prefillName: string
  onClose: () => void
  onCreated: (id: number, name: string) => void
}

function VenueQuickCreateDialog({ isOpen, prefillName, onClose, onCreated }: VenueQuickCreateProps) {
  const [name, setName] = useState(prefillName)
  const [city, setCity] = useState('')

  const createVenue = trpcReact.venue.create.useMutation({
    onSuccess: (venue) => {
      toast.success(`Venue "${venue.name}" created`)
      onCreated(venue.id, venue.name)
      onClose()
    },
    onError: (e) => toast.error('Failed to create venue', { description: e.message })
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    createVenue.mutate({ name: name.trim(), notes: city ? `City: ${city}` : '' })
  }

  if (isOpen && name !== prefillName && prefillName) {
    setName(prefillName)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Quick-add Venue</DialogTitle>
          <DialogDescription>Minimal info — you can fill the rest later.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="venue-name">Venue Name *</Label>
            <Input
              id="venue-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Zenith München"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="venue-city">City</Label>
            <Input
              id="venue-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Berlin"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || createVenue.isPending}>
              Create Venue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Person quick-create dialog ───────────────────────────────────────────────

interface PersonQuickCreateProps {
  isOpen: boolean
  prefillName: string
  onClose: () => void
  onCreated: (id: number, label: string) => void
}

function PersonQuickCreateDialog({ isOpen, prefillName, onClose, onCreated }: PersonQuickCreateProps) {
  const parts = prefillName.trim().split(' ')
  const [firstName, setFirstName] = useState(parts[0] ?? '')
  const [lastName, setLastName] = useState(parts.slice(1).join(' '))
  const [email, setEmail] = useState('')

  const createPerson = trpcReact.person.create.useMutation({
    onSuccess: (person) => {
      const label = `${person.firstName} ${person.lastName}`
      toast.success(`Person "${label}" created`)
      onCreated(person.id, label)
      onClose()
    },
    onError: (e) => toast.error('Failed to create person', { description: e.message })
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!firstName.trim() || !lastName.trim()) return
    createPerson.mutate({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      notes: null,
      contact: email ? { email, phone: '', mobilePhone: '', homepage: '' } : undefined
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Quick-add Person</DialogTitle>
          <DialogDescription>Minimal info — you can fill the rest later.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="person-first">First Name *</Label>
              <Input
                id="person-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="person-last">Last Name *</Label>
              <Input
                id="person-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="person-email">Email</Label>
            <Input
              id="person-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contact@example.com"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!firstName.trim() || !lastName.trim() || createPerson.isPending}>
              Create Person
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

const EMPTY_FORM: WizardFormData = {
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

export function CreateEventWizard({ isOpen, onClose, onSuccess }: CreateEventWizardProps) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<WizardFormData>(EMPTY_FORM)

  // Quick-create state
  const [bandQC, setBandQC] = useState({ open: false, prefill: '' })
  const [venueQC, setVenueQC] = useState({ open: false, prefill: '' })
  const [personQC, setPersonQC] = useState({ open: false, prefill: '' })

  // Combobox item labels (tracked after JiT create for display)
  const [bandLabel, setBandLabel] = useState<string | null>(null)
  const [venueLabel, setVenueLabel] = useState<string | null>(null)
  const [personLabel, setPersonLabel] = useState<string | null>(null)

  // Queries
  const bands = trpcReact.band.getListItems.useQuery()
  const venues = trpcReact.venue.getListItems.useQuery()
  const persons = trpcReact.person.getListItems.useQuery()
  const companies = trpcReact.company.getListItems.useQuery()

  const utils = trpcReact.useUtils()

  const createMemo = trpcReact.dealMemo.create.useMutation({
    onSuccess: (memo: any) => {
      toast.success('Event created', { description: `"${form.name}" has been added.` })
      utils.dealMemo.getAllPaginated.invalidate()
      handleClose()
      onSuccess(memo)
    },
    onError: (e) => toast.error('Failed to create event', { description: e.message })
  })

  const handleClose = () => {
    setStep(1)
    setForm(EMPTY_FORM)
    setBandLabel(null)
    setVenueLabel(null)
    setPersonLabel(null)
    onClose()
  }

  const set = <K extends keyof WizardFormData>(key: K, value: WizardFormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  // Step 1 validity
  const step1Valid = form.name.trim() !== '' && form.date !== '' && form.bandId !== null

  const handleSubmit = () => {
    if (!step1Valid) return
    createMemo.mutate({
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
  }

  const bandItems = [
    ...(bands.data ?? []).map((b) => ({ id: b.id, label: b.name })),
    ...(bandLabel && form.bandId && !bands.data?.find((b) => b.id === form.bandId)
      ? [{ id: form.bandId, label: bandLabel }]
      : [])
  ]

  const venueItems = [
    ...(venues.data ?? []).map((v) => ({ id: v.id, label: v.name })),
    ...(venueLabel && form.venueId && !venues.data?.find((v) => v.id === form.venueId)
      ? [{ id: form.venueId, label: venueLabel }]
      : [])
  ]

  const personItems = [
    ...(persons.data ?? []).map((p) => ({ id: p.id, label: `${p.firstName} ${p.lastName}` })),
    ...(personLabel && form.loProPersonId && !persons.data?.find((p) => p.id === form.loProPersonId)
      ? [{ id: form.loProPersonId, label: personLabel }]
      : [])
  ]

  const companyItems = (companies.data ?? []).map((c) => ({ id: c.id, label: c.name }))

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Event</DialogTitle>
            <DialogDescription>
              Fill in the required fields to get started. Optional steps can be completed later.
            </DialogDescription>
          </DialogHeader>

          <StepIndicator current={step} />

          {/* ── Step 1: Event & Band ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="event-name">
                  Event Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="event-name"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="e.g. Summer Festival 2024"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="event-date">
                  Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="event-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => set('date', e.target.value)}
                />
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>
                  Band <span className="text-destructive">*</span>
                </Label>
                <EntityCombobox
                  items={bandItems}
                  value={form.bandId}
                  onChange={(id) => set('bandId', id)}
                  placeholder="Select band…"
                  searchPlaceholder="Search bands…"
                  isLoading={bands.isLoading}
                  onCreateNew={(q) => setBandQC({ open: true, prefill: q })}
                  createNewLabel="Add new band"
                />
              </div>

              <div className="space-y-2">
                <Label>Venue <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <EntityCombobox
                  items={venueItems}
                  value={form.venueId}
                  onChange={(id) => set('venueId', id)}
                  placeholder="Select venue…"
                  searchPlaceholder="Search venues…"
                  isLoading={venues.isLoading}
                  onCreateNew={(q) => setVenueQC({ open: true, prefill: q })}
                  createNewLabel="Add new venue"
                />
              </div>
            </div>
          )}

          {/* ── Step 2: LoPro ── */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                The LoPro (Local Promoter) is the person and/or company responsible for the show on site.
              </p>

              <div className="space-y-2">
                <Label>LoPro Contact Person</Label>
                <EntityCombobox
                  items={personItems}
                  value={form.loProPersonId}
                  onChange={(id) => set('loProPersonId', id)}
                  placeholder="Select person…"
                  searchPlaceholder="Search persons…"
                  isLoading={persons.isLoading}
                  onCreateNew={(q) => setPersonQC({ open: true, prefill: q })}
                  createNewLabel="Add new person"
                />
              </div>

              <div className="space-y-2">
                <Label>LoPro Company</Label>
                <EntityCombobox
                  items={companyItems}
                  value={form.loProCompanyId}
                  onChange={(id) => set('loProCompanyId', id)}
                  placeholder="Select company…"
                  searchPlaceholder="Search companies…"
                  isLoading={companies.isLoading}
                />
              </div>
            </div>
          )}

          {/* ── Step 3: Deal Details ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => set('status', v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="vvk">Ticket Price VVK (€)</Label>
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
                  <Label htmlFor="ak">Ticket Price AK (€)</Label>
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
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  rows={3}
                  placeholder="Any additional information…"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="deal-terms">Deal Terms</Label>
                <Input
                  id="deal-terms"
                  value={form.deal}
                  onChange={(e) => set('deal', e.target.value)}
                  placeholder="e.g. 70/30, flat fee €2 000, guarantee €1 500 + 80%…"
                />
                <p className="text-xs text-muted-foreground">
                  The financial split or fee arrangement for this show (optional).
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="mt-2 flex items-center justify-between sm:justify-between">
            <div className="flex gap-2">
              {step > 1 && (
                <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>
                  Back
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {step < 3 && (
                <>
                  {step > 1 && (
                    <Button type="button" variant="outline" onClick={() => setStep(step + 1)}>
                      Skip
                    </Button>
                  )}
                  <Button
                    type="button"
                    onClick={() => setStep(step + 1)}
                    disabled={step === 1 && !step1Valid}
                  >
                    Next
                  </Button>
                </>
              )}
              {step === 3 && (
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!step1Valid || createMemo.isPending}
                >
                  {createMemo.isPending ? 'Creating…' : 'Create Event'}
                </Button>
              )}
              {step === 1 && step1Valid && (
                <Button type="button" variant="outline" onClick={handleSubmit} disabled={createMemo.isPending}>
                  {createMemo.isPending ? 'Creating…' : 'Quick Create'}
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

      <PersonQuickCreateDialog
        isOpen={personQC.open}
        prefillName={personQC.prefill}
        onClose={() => setPersonQC({ open: false, prefill: '' })}
        onCreated={(id, label) => {
          set('loProPersonId', id)
          setPersonLabel(label)
          utils.person.getListItems.invalidate()
        }}
      />
    </>
  )
}
