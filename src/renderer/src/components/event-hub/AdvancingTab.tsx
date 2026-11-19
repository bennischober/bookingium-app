import { useState } from 'react'
import { Mail, Phone, UserRound } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { useSyncedStateByKey } from '@/hooks/useSyncedState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { EntityCombobox } from '@/components/ui/entity-combobox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { PersonQuickCreateDialog } from '@/components/quick-create/PersonQuickCreateDialog'
import { personFromSearch, type PersonPrefill } from '@/components/quick-create/personPrefill'
import {
  ADVANCING_STATUS_LABELS,
  AdvancingStatus,
  type ShowAdvancingDto
} from '../../../../main/api/schemas/advancing.schema'

type Draft = {
  status: AdvancingStatus
  statusDate: string
  localContactId: number | null
  notes: string
}

const draftOf = (show: ShowAdvancingDto): Draft => ({
  status: show.status,
  statusDate: show.statusDate ?? '',
  localContactId: show.localContact?.id ?? null,
  notes: show.notes
})

const today = (): string => new Date().toISOString().slice(0, 10)

/**
 * #232: Advancing - agreeing the show with the promoter: how far it is, the contact on site
 * (Kontakt vor Ort, not the promoter's contact) and what is still open.
 */
export function AdvancingTab({ eventId }: { eventId: number }) {
  const utils = trpcReact.useUtils()
  const show = trpcReact.advancing.get.useQuery({ eventId })
  const persons = trpcReact.person.getListItems.useQuery()
  const [createPerson, setCreatePerson] = useState<PersonPrefill | null>(null)
  const loaded = show.data
  const [draft, setDraft] = useSyncedStateByKey<Draft | null>(
    loaded ? draftOf(loaded) : null,
    JSON.stringify(loaded ? draftOf(loaded) : null)
  )

  const save = trpcReact.advancing.save.useMutation({
    onSuccess: (saved) => {
      utils.advancing.get.setData({ eventId }, saved)
      void utils.advancing.tour.invalidate()
      toast.success('Advancing gespeichert')
    },
    onError: (error) =>
      toast.error('Advancing konnte nicht gespeichert werden', { description: error.message })
  })

  if (show.isLoading || !loaded || !draft) {
    return <p className="text-sm text-muted-foreground">Wird geladen…</p>
  }
  if (show.error) return <p className="text-sm text-destructive">{show.error.message}</p>

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft({ ...draft, [key]: value })
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(loaded))
  const contact =
    loaded.localContact && loaded.localContact.id === draft.localContactId
      ? loaded.localContact
      : null
  const personItems = (persons.data ?? []).map((p) => ({
    id: p.id,
    label: `${p.firstName} ${p.lastName}`.trim()
  }))

  return (
    <div className="grid max-w-4xl gap-6 md:grid-cols-2">
      <section className="space-y-4 rounded-lg border p-4" aria-label="Stand">
        <h3 className="font-semibold">Stand</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="advancing-status">Status</Label>
            <Select
              value={draft.status}
              onValueChange={(value) =>
                setDraft({
                  ...draft,
                  status: value as AdvancingStatus,
                  // a new stage is usually reached today
                  statusDate: value === draft.status ? draft.statusDate : today()
                })
              }
            >
              <SelectTrigger id="advancing-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AdvancingStatus.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {ADVANCING_STATUS_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="advancing-date">seit</Label>
            <Input
              id="advancing-date"
              type="date"
              value={draft.statusDate}
              onChange={(event) => set('statusDate', event.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="advancing-notes">Offene Punkte / Notizen</Label>
          <Textarea
            id="advancing-notes"
            rows={6}
            value={draft.notes}
            onChange={(event) => set('notes', event.target.value)}
            placeholder="Technik, Catering, Parken, Load-in, Hotel…"
          />
        </div>
      </section>

      <section className="space-y-4 rounded-lg border p-4" aria-label="Kontakt vor Ort">
        <h3 className="font-semibold">Kontakt vor Ort</h3>
        <p className="text-sm text-muted-foreground">
          Wer am Showtag im Club ansprechbar ist – nicht der Veranstalter.
        </p>
        <EntityCombobox
          items={personItems}
          value={draft.localContactId}
          onChange={(id) => set('localContactId', id)}
          placeholder="Person auswählen…"
          searchPlaceholder="Personen suchen…"
          isLoading={persons.isLoading}
          onCreateNew={(query) => setCreatePerson(personFromSearch(query))}
          createNewLabel="Neue Person anlegen"
        />
        {contact && (
          <div className="space-y-1 text-sm">
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                className="flex items-center gap-2 hover:underline"
              >
                <Mail className="h-4 w-4 text-muted-foreground" /> {contact.email}
              </a>
            )}
            {contact.phone && (
              <p className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" /> {contact.phone}
              </p>
            )}
          </div>
        )}
        {!draft.localContactId && loaded.suggestedContact && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-2 text-sm">
            <UserRound className="h-4 w-4 text-muted-foreground" />
            <span>
              Letzte Show im Club: <strong>{loaded.suggestedContact.name}</strong>
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => set('localContactId', loaded.suggestedContact!.id)}
            >
              Übernehmen
            </Button>
          </div>
        )}
      </section>

      <div className="flex gap-2 md:col-span-2">
        <Button
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate({
              eventId,
              status: draft.status,
              statusDate: draft.statusDate || null,
              localContactId: draft.localContactId,
              notes: draft.notes
            })
          }
        >
          {save.isPending ? 'Wird gespeichert…' : 'Speichern'}
        </Button>
        {dirty && (
          <Button variant="outline" onClick={() => setDraft(draftOf(loaded))}>
            Verwerfen
          </Button>
        )}
      </div>

      {createPerson && (
        <PersonQuickCreateDialog
          isOpen
          prefill={createPerson}
          onClose={() => setCreatePerson(null)}
          onCreated={(id) => {
            set('localContactId', id)
            void utils.person.getListItems.invalidate()
          }}
        />
      )}
    </div>
  )
}
