import { useMemo, useState } from 'react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { confirmAction } from '@/lib/confirm'
import {
  EMPTY_FILTERS,
  LARGE_LIST,
  activeFilterCount,
  addresses,
  filtersChanged,
  sameFilters
} from '@/components/contact-list/contactListState'
import { ContactListFilterPanel } from '@/components/contact-list/ContactListFilterPanel'
import { SavedListControls } from '@/components/contact-list/SavedListControls'
import { ContactListSendActions } from '@/components/contact-list/ContactListSendActions'
import { contactListColumns } from '@/components/contact-list/contactListColumns'
import {
  ContactListNameDialog,
  type ContactListNameDraft
} from '@/components/contact-list/ContactListNameDialog'
import { ExcludedContactsDialog } from '@/components/contact-list/ExcludedContactsDialog'
import type {
  ContactListFilters,
  ContactListRecipientDto,
  ContactListSource
} from '../../../main/api/schemas/contactList.schema'

export default function ContactListPage() {
  const [filters, setFilters] = useState<ContactListFilters>(EMPTY_FILTERS)
  const [savedId, setSavedId] = useState<number | null>(null)
  const [nameDialog, setNameDialog] = useState<ContactListNameDraft | null>(null)
  const [showExcluded, setShowExcluded] = useState(false)
  // Beside the table on wide windows; on narrow ones the table gets the room
  const [filtersOpen, setFiltersOpen] = useState(
    () => window.matchMedia('(min-width: 1280px)').matches
  )

  const utils = trpcReact.useUtils()
  // Genres and states change on other pages: fresh each time the page opens
  const options = trpcReact.contactList.filterOptions.useQuery(undefined, {
    refetchOnMount: 'always'
  })
  const savedLists = trpcReact.contactList.listSaved.useQuery()
  const saved = savedLists.data?.find((entry) => entry.id === savedId) ?? null
  // #154: a fixed set of contacts (e.g. an imported CSV list); filters don't apply
  const memberList = saved?.kind === 'members' ? saved : null
  const source: ContactListSource = memberList ? { memberListId: memberList.id } : filters
  const list = trpcReact.contactList.build.useQuery(source, { keepPreviousData: true })

  const recipients = useMemo(() => list.data?.recipients ?? [], [list.data])
  const excluded = list.data?.excluded ?? []
  const changed = filtersChanged(saved, filters)

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

  const removeMemberMutation = trpcReact.contactList.removeMember.useMutation({
    onSuccess: () => void utils.contactList.build.invalidate(),
    onError: (error) =>
      toast.error('Kontakt konnte nicht entfernt werden', { description: error.message })
  })

  const removeMember = async (row: ContactListRecipientDto) => {
    if (
      memberList &&
      (await confirmAction({
        title: `${row.name || row.email} aus „${memberList.name}“ entfernen?`,
        description: 'Der Kontakt selbst bleibt erhalten.',
        confirmLabel: 'Entfernen',
        destructive: true
      }))
    ) {
      removeMemberMutation.mutate(
        { listId: memberList.id, email: row.email },
        { onSuccess: () => toast.success(`${row.email} aus dem Verteiler entfernt`) }
      )
    }
  }

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

  const handleNamed = (draft: ContactListNameDraft) => {
    // Renaming keeps the saved filters; unsaved changes stay unsaved
    const named = draft.id !== undefined && saved ? saved.filters : filters
    saveMutation.mutate({ id: draft.id, name: draft.name, filters: named })
  }

  const handleDelete = async () => {
    if (
      saved &&
      (await confirmAction({
        title: `Verteiler „${saved.name}“ löschen?`,
        description: memberList
          ? 'Nur der Verteiler wird gelöscht, die Kontakte bleiben erhalten.'
          : 'Nur die gespeicherten Filter werden gelöscht, keine Kontakte.',
        confirmLabel: 'Löschen',
        destructive: true
      }))
    ) {
      deleteMutation.mutate(saved.id)
    }
  }

  const columns = contactListColumns({
    onRemoveMember: memberList ? (row) => void removeMember(row) : undefined,
    onNoAdvertising: (email) => setNoAdvertising(email, true)
  })

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-2">Verteiler</h1>
          <p className="text-sm text-muted-foreground">
            {memberList
              ? 'Feste Kontakte, z. B. aus einer importierten Liste. Es gilt jeweils die Haupt-E-Mail des Kontakts.'
              : 'Empfänger für Rundmails aus Clubs, Festivals und Radio/Medien nach Region, Genre, Größe und Buchungen zusammenstellen.'}
          </p>
        </div>
        <SavedListControls
          savedLists={savedLists.data}
          savedId={savedId}
          saved={saved}
          onChoose={chooseSaved}
          filtersOpen={filtersOpen}
          onToggleFilters={() => setFiltersOpen((open) => !open)}
          activeFilters={activeFilterCount(filters)}
          changed={changed}
          saving={saveMutation.isLoading}
          onSave={handleSave}
          onSaveAs={() => saved && setNameDialog({ name: `${saved.name} (Kopie)` })}
          onRename={() => saved && setNameDialog({ id: saved.id, name: saved.name })}
          onDelete={handleDelete}
        />
      </div>

      <div className="flex min-h-0 flex-1 gap-6">
        {filtersOpen && !memberList && (
          <ContactListFilterPanel
            filters={filters}
            onChange={update}
            options={options.data}
            changed={changed}
            hasSaved={saved !== null}
            onReset={() => setFilters(saved?.filters ?? EMPTY_FILTERS)}
          />
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
            filtered={!memberList && !sameFilters(EMPTY_FILTERS, filters)}
            actionButton={
              <ContactListSendActions
                source={source}
                name={saved?.name ?? ''}
                empty={recipients.length === 0}
              />
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

      <ContactListNameDialog
        draft={nameDialog}
        onDraftChange={setNameDialog}
        onSubmit={handleNamed}
        saving={saveMutation.isLoading}
        memberList={memberList !== null}
      />

      <ExcludedContactsDialog
        open={showExcluded}
        onOpenChange={setShowExcluded}
        excluded={excluded}
        memberList={memberList !== null}
        restoring={noAdvertisingMutation.isLoading}
        onRestore={(email) => setNoAdvertising(email, false)}
      />
    </div>
  )
}
