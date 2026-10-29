import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Ban, Copy, FileDown, Mail, SlidersHorizontal, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import { trpcReact } from '@/lib/trpc'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MultiSelect } from '@/components/ui/multi-select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
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
import { RowActionButton, RowActions } from '@/components/row-action-button'
import { useExportToast } from '@/components/export/useExportToast'
import { confirmAction } from '@/lib/confirm'
import { VENUE_KIND_LABELS, VenueKind } from '../../../main/api/schemas/venue.schema'
import {
  BookedFilter,
  ContactListFilters,
  RECIPIENT_TYPE_LABELS,
  RecipientType,
  type ContactListRecipientDto
} from '../../../main/api/schemas/contactList.schema'

const EMPTY_FILTERS: ContactListFilters = ContactListFilters.parse({})

// Above this, mail providers start to refuse or flag a BCC email
const LARGE_LIST = 50

const countryNames = new Intl.DisplayNames(['de'], { type: 'region' })
function countryLabel(code: string): string {
  try {
    return countryNames.of(code) ?? code
  } catch {
    return code
  }
}

const sameFilters = (a: ContactListFilters, b: ContactListFilters) =>
  JSON.stringify(a) === JSON.stringify(b)

function parseCapacity(value: string): number | null {
  const number = Number.parseInt(value.replace(/\D/g, ''), 10)
  return Number.isNaN(number) ? null : number
}

/** How many filters narrow the list (the Filter button's count) */
function activeFilterCount(filters: ContactListFilters): number {
  return [
    filters.kinds.length > 0,
    filters.recipientTypes.length > 0,
    filters.countryCodes.length > 0,
    filters.states.length > 0,
    filters.zipPrefixes.trim() !== '',
    filters.capacityMin !== null || filters.capacityMax !== null,
    filters.genres.length > 0,
    filters.booked !== 'all'
  ].filter(Boolean).length
}

const addresses = (count: number) => `${count} ${count === 1 ? 'Adresse' : 'Adressen'}`

/** The Verteiler, or a note while "Verteiler (experimentell)" is off (the menu then has no entry) */
export default function ContactListPage() {
  const navigate = useNavigate()
  const settings = trpcReact.settings.get.useQuery()
  if (!settings.data) return null
  if (settings.data.contactLists) return <ContactLists />
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-bold">Verteiler</h1>
      <p className="text-sm text-muted-foreground">Die Verteiler sind ausgeschaltet.</p>
      <Button onClick={() => void navigate({ to: '/settings' })}>Zu den Einstellungen</Button>
    </div>
  )
}

function ContactLists() {
  const [filters, setFilters] = useState<ContactListFilters>(EMPTY_FILTERS)
  const [savedId, setSavedId] = useState<number | null>(null)
  const [nameDialog, setNameDialog] = useState<{ id?: number; name: string } | null>(null)
  const [showExcluded, setShowExcluded] = useState(false)
  // Beside the table on wide windows; on narrow ones the table gets the room
  const [filtersOpen, setFiltersOpen] = useState(
    () => window.matchMedia('(min-width: 1280px)').matches
  )
  const activeFilters = activeFilterCount(filters)

  const utils = trpcReact.useUtils()
  const exportToast = useExportToast()
  const options = trpcReact.contactList.filterOptions.useQuery()
  const savedLists = trpcReact.contactList.listSaved.useQuery()
  const list = trpcReact.contactList.build.useQuery(filters, { keepPreviousData: true })

  const recipients = useMemo(() => list.data?.recipients ?? [], [list.data])
  const excluded = list.data?.excluded ?? []
  const saved = savedLists.data?.find((entry) => entry.id === savedId) ?? null
  const changed = saved
    ? !sameFilters(saved.filters, filters)
    : !sameFilters(EMPTY_FILTERS, filters)

  const update = (patch: Partial<ContactListFilters>) =>
    setFilters((current) => ({ ...current, ...patch }))

  const saveMutation = trpcReact.contactList.save.useMutation({
    onSuccess: (result) => {
      setSavedId(result.id)
      setNameDialog(null)
      void utils.contactList.listSaved.invalidate()
      toast.success(`Verteiler „${result.name}“ gespeichert`)
    },
    onError: (error) =>
      toast.error('Verteiler konnte nicht gespeichert werden', { description: error.message })
  })

  const deleteMutation = trpcReact.contactList.deleteSaved.useMutation({
    onSuccess: () => {
      setSavedId(null)
      void utils.contactList.listSaved.invalidate()
      toast.success('Verteiler gelöscht')
    },
    onError: (error) =>
      toast.error('Verteiler konnte nicht gelöscht werden', { description: error.message })
  })

  const noAdvertisingMutation = trpcReact.contactList.setNoAdvertising.useMutation({
    onSuccess: () => void utils.contactList.build.invalidate(),
    onError: (error) => toast.error('Änderung fehlgeschlagen', { description: error.message })
  })

  const setNoAdvertising = (email: string, noAdvertising: boolean) =>
    noAdvertisingMutation.mutate(
      { email, noAdvertising },
      {
        onSuccess: () =>
          noAdvertising
            ? toast.success(`${email}: Keine Werbung`, {
                description: 'Die Adresse kommt in keinen Verteiler mehr.',
                action: { label: 'Rückgängig', onClick: () => setNoAdvertising(email, false) }
              })
            : toast.success(`${email} wieder aufgenommen`)
      }
    )

  const writeEmail = trpcReact.contactList.writeEmail.useMutation({
    onSuccess: ({ count, withRecipients }) => {
      if (count === 0) toast.info('Der Verteiler hat keine Adressen.')
      else if (withRecipients) toast.success(`E-Mail mit ${addresses(count)} in BCC geöffnet`)
      else {
        toast.success(`${addresses(count)} kopiert`, {
          description: 'Zu viele für einen Link: bitte in der neuen E-Mail ins BCC-Feld einfügen.',
          duration: 10000
        })
      }
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

  const chooseSaved = (value: string) => {
    if (value === 'new') {
      setSavedId(null)
      setFilters(EMPTY_FILTERS)
      return
    }
    const entry = savedLists.data?.find((candidate) => String(candidate.id) === value)
    if (entry) {
      setSavedId(entry.id)
      setFilters(entry.filters)
    }
  }

  const handleSave = () => {
    if (saved) saveMutation.mutate({ id: saved.id, name: saved.name, filters })
    else setNameDialog({ name: '' })
  }

  const handleDelete = async () => {
    if (
      saved &&
      (await confirmAction({
        title: `Verteiler „${saved.name}“ löschen?`,
        description: 'Nur die gespeicherten Filter werden gelöscht, keine Kontakte.',
        confirmLabel: 'Löschen',
        destructive: true
      }))
    ) {
      deleteMutation.mutate(saved.id)
    }
  }

  const columns: ColumnDef<ContactListRecipientDto>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => <span className="font-medium">{row.original.name || '-'}</span>
    },
    { accessorKey: 'email', header: 'E-Mail' },
    {
      id: 'types',
      header: 'Art',
      cell: ({ row }) => row.original.types.map((type) => RECIPIENT_TYPE_LABELS[type]).join(', ')
    },
    {
      id: 'venues',
      header: 'Spielstätten',
      cell: ({ row }) => {
        const names = row.original.venues.map((venue) =>
          venue.role ? `${venue.name} (${venue.role})` : venue.name
        )
        const text = names.join(', ')
        return <span title={text}>{text.length > 60 ? `${text.slice(0, 60)}...` : text}</span>
      }
    },
    {
      id: 'place',
      header: 'Ort',
      cell: ({ row }) => [row.original.city, row.original.country].filter(Boolean).join(', ') || '-'
    },
    {
      accessorKey: 'capacity',
      header: 'Kapazität',
      cell: ({ row }) =>
        row.original.capacity ? row.original.capacity.toLocaleString('de-DE') : '-'
    },
    {
      id: 'actions',
      header: 'Aktionen',
      cell: ({ row }) => (
        <RowActions>
          <RowActionButton
            icon={Ban}
            label="Keine Werbung"
            destructive
            onClick={() => setNoAdvertising(row.original.email, true)}
          />
        </RowActions>
      )
    }
  ]

  const busy = writeEmail.isLoading || copyAddresses.isLoading || exportCsv.isLoading
  const empty = recipients.length === 0

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-2">Verteiler</h1>
          <p className="text-sm text-muted-foreground">
            Empfänger für Rundmails nach Art, Region, Genre, Größe und Buchungen zusammenstellen.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={filtersOpen ? 'secondary' : 'outline'}
            aria-pressed={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filter
            {activeFilters > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-xs leading-5 text-primary-foreground">
                {activeFilters}
              </span>
            )}
          </Button>
          <Select value={savedId === null ? 'new' : String(savedId)} onValueChange={chooseSaved}>
            <SelectTrigger className="w-56" aria-label="Gespeicherter Verteiler">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">Neuer Verteiler</SelectItem>
              {savedLists.data?.map((entry) => (
                <SelectItem key={entry.id} value={String(entry.id)}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={handleSave}
            disabled={!changed || saveMutation.isLoading}
          >
            Speichern
          </Button>
          {saved && (
            <>
              <Button
                variant="outline"
                onClick={() => setNameDialog({ name: `${saved.name} (Kopie)` })}
              >
                Speichern unter…
              </Button>
              <Button
                variant="outline"
                onClick={() => setNameDialog({ id: saved.id, name: saved.name })}
              >
                Umbenennen
              </Button>
              <Button variant="outline" onClick={handleDelete}>
                Löschen
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-6">
        {filtersOpen && (
          <aside
            className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto pr-1"
            aria-label="Filter"
          >
            <div className="space-y-2">
              <Label>Art</Label>
              <ToggleGroup
                type="multiple"
                variant="outline"
                size="sm"
                className="justify-start"
                value={filters.kinds}
                onValueChange={(value) => update({ kinds: value as VenueKind[] })}
              >
                {VenueKind.options.map((kind) => (
                  <ToggleGroupItem key={kind} value={kind}>
                    {kind === 'venue' ? 'Spielstätten' : 'Festivals'}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            <div className="space-y-2">
              <Label>Empfänger</Label>
              <ToggleGroup
                type="multiple"
                variant="outline"
                size="sm"
                className="flex-wrap justify-start"
                value={filters.recipientTypes}
                onValueChange={(value) => update({ recipientTypes: value as RecipientType[] })}
              >
                {RecipientType.options.map((type) => (
                  <ToggleGroupItem key={type} value={type}>
                    {type === 'venue' ? VENUE_KIND_LABELS.venue : RECIPIENT_TYPE_LABELS[type]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="text-xs text-muted-foreground">Keine Auswahl: alle.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact-list-country">Land</Label>
              <MultiSelect
                id="contact-list-country"
                value={filters.countryCodes}
                onChange={(value) => update({ countryCodes: value })}
                options={(options.data?.countryCodes ?? []).map((code) => ({
                  value: code,
                  label: countryLabel(code)
                }))}
                placeholder="Alle Länder"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact-list-state">Bundesland / Region</Label>
              <MultiSelect
                id="contact-list-state"
                value={filters.states}
                onChange={(value) => update({ states: value })}
                options={(options.data?.states ?? []).map((state) => ({
                  value: state,
                  label: state
                }))}
                placeholder="Alle Regionen"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact-list-zip">PLZ beginnt mit</Label>
              <Input
                id="contact-list-zip"
                value={filters.zipPrefixes}
                onChange={(event) => update({ zipPrefixes: event.target.value })}
                placeholder="z. B. 7, 80"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact-list-capacity-min">Kapazität</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="contact-list-capacity-min"
                  inputMode="numeric"
                  aria-label="Kapazität ab"
                  placeholder="ab"
                  value={filters.capacityMin ?? ''}
                  onChange={(event) => update({ capacityMin: parseCapacity(event.target.value) })}
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  inputMode="numeric"
                  aria-label="Kapazität bis"
                  placeholder="bis"
                  value={filters.capacityMax ?? ''}
                  onChange={(event) => update({ capacityMax: parseCapacity(event.target.value) })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact-list-genre">Genre</Label>
              <MultiSelect
                id="contact-list-genre"
                value={filters.genres}
                onChange={(value) => update({ genres: value })}
                options={(options.data?.genres ?? []).map((genre) => ({
                  value: genre,
                  label: genre
                }))}
                placeholder="Alle Genres"
                emptyText="Keine Genres. Bei Spielstätten und Bands eintragen."
              />
              <p className="text-xs text-muted-foreground">
                Genres der Spielstätte und der Bands, die dort gespielt haben.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact-list-booked">Buchungen</Label>
              <Select
                value={filters.booked}
                onValueChange={(value) => update({ booked: value as BookedFilter })}
              >
                <SelectTrigger id="contact-list-booked">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle</SelectItem>
                  <SelectItem value="booked">Schon gebucht</SelectItem>
                  <SelectItem value="never">Noch nie gebucht</SelectItem>
                </SelectContent>
              </Select>
              {filters.booked !== 'all' && (
                <SearchableSelect
                  aria-label="Band"
                  value={filters.bandId}
                  onChange={(value) => update({ bandId: value })}
                  options={(options.data?.bands ?? []).map((band) => ({
                    value: band.id,
                    label: band.name
                  }))}
                  noneLabel="Alle Bands"
                  searchPlaceholder="Band suchen…"
                />
              )}
            </div>

            {changed && (
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => setFilters(saved?.filters ?? EMPTY_FILTERS)}
              >
                <Undo2 className="h-4 w-4" />
                {saved ? 'Änderungen verwerfen' : 'Filter zurücksetzen'}
              </Button>
            )}

            <p className="mt-auto border-t pt-4 text-xs text-muted-foreground">
              Werbe-E-Mails nur an Empfänger, die eingewilligt haben oder mit denen Sie schon
              zusammenarbeiten (§ 7 UWG). Wer widerspricht, wird als „Keine Werbung“ markiert.
            </p>
          </aside>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <DataTable
            columns={columns}
            data={recipients}
            total={recipients.length}
            itemLabel={{ singular: 'Adresse', plural: 'Adressen' }}
            isLoading={list.isLoading}
            error={list.error}
            onRetry={() => void list.refetch()}
            filtered={!sameFilters(EMPTY_FILTERS, filters)}
            actionButton={
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  disabled={empty || busy}
                  onClick={() => copyAddresses.mutate(filters)}
                >
                  <Copy className="h-4 w-4" />
                  Adressen kopieren
                </Button>
                <Button
                  variant="outline"
                  disabled={empty || busy}
                  onClick={() => exportCsv.mutate({ filters, name: saved?.name ?? '' })}
                >
                  <FileDown className="h-4 w-4" />
                  CSV exportieren
                </Button>
                <Button disabled={empty || busy} onClick={() => writeEmail.mutate(filters)}>
                  <Mail className="h-4 w-4" />
                  E-Mail schreiben
                </Button>
              </div>
            }
          />
          {(recipients.length > LARGE_LIST || excluded.length > 0) && (
            <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>
                {recipients.length > LARGE_LIST &&
                  'Für große Verteiler besser die CSV in einen Newsletter-Dienst laden (Brevo, CleverReach, Mailchimp): Mail-Anbieter begrenzen die Empfänger pro E-Mail.'}
              </span>
              {excluded.length > 0 && (
                <Button variant="link" className="h-auto p-0" onClick={() => setShowExcluded(true)}>
                  {addresses(excluded.length)} mit „Keine Werbung“ ausgeschlossen
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog open={nameDialog !== null} onOpenChange={(open) => !open && setNameDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!nameDialog) return
              // Renaming keeps the saved filters; unsaved changes stay unsaved
              const renamed = nameDialog.id !== undefined && saved ? saved.filters : filters
              saveMutation.mutate({ id: nameDialog.id, name: nameDialog.name, filters: renamed })
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {nameDialog?.id !== undefined ? 'Verteiler umbenennen' : 'Verteiler speichern'}
              </DialogTitle>
              <DialogDescription>
                Gespeichert werden die Filter, nicht die Adressen.
              </DialogDescription>
            </DialogHeader>
            <div className="my-4 space-y-2">
              <Label htmlFor="contact-list-name">Name</Label>
              <Input
                id="contact-list-name"
                autoFocus
                value={nameDialog?.name ?? ''}
                onChange={(event) =>
                  setNameDialog((current) => current && { ...current, name: event.target.value })
                }
                placeholder="z. B. Clubs Süddeutschland"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNameDialog(null)}>
                Abbrechen
              </Button>
              <Button type="submit" disabled={!nameDialog?.name.trim() || saveMutation.isLoading}>
                Speichern
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showExcluded} onOpenChange={setShowExcluded}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Keine Werbung</DialogTitle>
            <DialogDescription>
              Diese Adressen passen zu den Filtern, bekommen aber keine Rundmails.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-80 divide-y overflow-y-auto">
            {excluded.map((row) => (
              <li key={row.email} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{row.name || row.email}</div>
                  <div className="truncate text-sm text-muted-foreground">{row.email}</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={noAdvertisingMutation.isLoading}
                  onClick={() => setNoAdvertising(row.email, false)}
                >
                  Wieder aufnehmen
                </Button>
              </li>
            ))}
            {excluded.length === 0 && (
              <li className="py-2 text-sm text-muted-foreground">Keine mehr.</li>
            )}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  )
}
