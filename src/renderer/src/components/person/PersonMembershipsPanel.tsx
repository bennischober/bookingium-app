import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchableSelect } from '@/components/ui/searchable-select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import { confirmAction } from '@/lib/confirm'

type MembershipType = 'band' | 'company' | 'venue'

type MembershipRow = {
  id: number
  entityId: number
  entityName: string
  role: string
  notes: string
}

const LABELS: Record<MembershipType, { entity: string; add: string; empty: string }> = {
  band: { entity: 'Band', add: 'Zur Band hinzufügen', empty: 'Kein Mitglied einer Band.' },
  company: {
    entity: 'Firma',
    add: 'Zur Firma hinzufügen',
    empty: 'Keiner Firma zugeordnet.'
  },
  venue: {
    entity: 'Club / Festival',
    add: 'Zu Club / Festival hinzufügen',
    empty: 'Keinem Club und keinem Festival zugeordnet.'
  }
}

/** Link to the band, company or venue page */
function EntityLink({ type, row }: { type: MembershipType; row: MembershipRow }) {
  const className = 'font-medium truncate hover:underline'
  const id = String(row.entityId)
  if (type === 'band') {
    return (
      <Link to="/band/$bandId" params={{ bandId: id }} className={className}>
        {row.entityName}
      </Link>
    )
  }
  if (type === 'company') {
    return (
      <Link to="/companies/$companyId" params={{ companyId: id }} className={className}>
        {row.entityName}
      </Link>
    )
  }
  return (
    <Link to="/venues/$venueId" params={{ venueId: id }} className={className}>
      {row.entityName}
    </Link>
  )
}

/**
 * A person's memberships of one kind (bands, companies or venues) with
 * add/edit-role/remove: the person-side counterpart of MembersPanel.
 */
export function PersonMembershipsPanel({
  personId,
  type
}: {
  personId: number
  type: MembershipType
}) {
  const labels = LABELS[type]
  const utils = trpcReact.useUtils()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [entityId, setEntityId] = useState('')
  const [role, setRole] = useState('')
  const [notes, setNotes] = useState('')

  // One query for all three tabs; react-query shares it
  const relations = trpcReact.relation.getPersonRelations.useQuery({ personId })
  const bands = trpcReact.band.getListItems.useQuery(undefined, {
    enabled: dialogOpen && type === 'band'
  })
  const companies = trpcReact.company.getListItems.useQuery(undefined, {
    enabled: dialogOpen && type === 'company'
  })
  const venues = trpcReact.venue.getListItems.useQuery(undefined, {
    enabled: dialogOpen && type === 'venue'
  })

  const rows: MembershipRow[] =
    type === 'band'
      ? (relations.data?.bands ?? []).map((m) => ({
          id: m.id,
          entityId: m.bandId,
          entityName: m.bandName,
          role: m.role,
          notes: m.notes
        }))
      : type === 'company'
        ? (relations.data?.companies ?? []).map((m) => ({
            id: m.id,
            entityId: m.companyId,
            entityName: m.companyName,
            role: m.role,
            notes: m.notes
          }))
        : (relations.data?.venues ?? []).map((m) => ({
            id: m.id,
            entityId: m.venueId,
            entityName: m.venueName,
            role: m.role,
            notes: m.notes
          }))

  const options = (
    (type === 'band' ? bands.data : type === 'company' ? companies.data : venues.data) ?? []
  ).map((entity) => ({ value: String(entity.id), label: entity.name }))

  const handlers = (success: string, close = true) => ({
    onSuccess: () => {
      // Member lists on the band/company/venue pages change too
      void utils.relation.invalidate()
      if (close) setDialogOpen(false)
      toast.success(success)
    },
    onError: (error: { message: string }) =>
      toast.error('Speichern fehlgeschlagen', { description: error.message })
  })

  const addBand = trpcReact.relation.addBandMember.useMutation(handlers('Zur Band hinzugefügt'))
  const addCompany = trpcReact.relation.addCompanyMember.useMutation(
    handlers('Zur Firma hinzugefügt')
  )
  const addVenue = trpcReact.relation.addVenueMember.useMutation(
    handlers('Zu Club / Festival hinzugefügt')
  )
  const updateBand = trpcReact.relation.updateBandMember.useMutation(
    handlers('Zugehörigkeit aktualisiert')
  )
  const updateCompany = trpcReact.relation.updateCompanyMember.useMutation(
    handlers('Zugehörigkeit aktualisiert')
  )
  const updateVenue = trpcReact.relation.updateVenueMember.useMutation(
    handlers('Zugehörigkeit aktualisiert')
  )
  const removeBand = trpcReact.relation.removeBandMember.useMutation(handlers('Entfernt', false))
  const removeCompany = trpcReact.relation.removeCompanyMember.useMutation(
    handlers('Entfernt', false)
  )
  const removeVenue = trpcReact.relation.removeVenueMember.useMutation(handlers('Entfernt', false))

  const openAdd = () => {
    setEditingId(null)
    setEntityId('')
    setRole('')
    setNotes('')
    setDialogOpen(true)
  }

  const openEdit = (row: MembershipRow) => {
    setEditingId(row.id)
    setEntityId(String(row.entityId))
    setRole(row.role)
    setNotes(row.notes)
    setDialogOpen(true)
  }

  const handleSave = () => {
    if (editingId === null) {
      if (!entityId) {
        toast.error(`Bitte eine ${labels.entity} auswählen`)
        return
      }
      if (!role.trim()) {
        toast.error('Bitte eine Rolle angeben')
        return
      }
      const base = { personId, role: role.trim(), notes }
      if (type === 'band') addBand.mutate({ ...base, bandId: Number(entityId) })
      else if (type === 'company') addCompany.mutate({ ...base, companyId: Number(entityId) })
      else addVenue.mutate({ ...base, venueId: Number(entityId) })
      return
    }

    const update = { id: editingId, role: role.trim() || undefined, notes }
    if (type === 'band') updateBand.mutate(update)
    else if (type === 'company') updateCompany.mutate(update)
    else updateVenue.mutate(update)
  }

  const handleRemove = async (row: MembershipRow) => {
    const confirmed = await confirmAction({
      title: `Aus „${row.entityName}“ entfernen?`,
      confirmLabel: 'Entfernen',
      destructive: true
    })
    if (!confirmed) return
    if (type === 'band') removeBand.mutate({ id: row.id })
    else if (type === 'company') removeCompany.mutate({ id: row.id })
    else removeVenue.mutate({ id: row.id })
  }

  return (
    <>
      <div className="space-y-3">
        <Button size="sm" variant="outline" onClick={openAdd} className="w-full">
          <Plus className="mr-2 h-4 w-4" />
          {labels.add}
        </Button>

        {relations.isLoading ? (
          <p className="text-sm text-muted-foreground">Zugehörigkeiten werden geladen…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{labels.empty}</p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between rounded border p-3">
              <div className="flex min-w-0 flex-1 flex-col items-start">
                <EntityLink type={type} row={row} />
                {row.role && (
                  <Badge variant="secondary" className="mt-1">
                    {row.role}
                  </Badge>
                )}
                {row.notes && <p className="mt-1 text-xs text-muted-foreground">{row.notes}</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(row)}
                  title="Rolle bearbeiten"
                  aria-label={`Rolle von ${row.entityName} bearbeiten`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(row)}
                  title="Entfernen"
                  aria-label={`${row.entityName} entfernen`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId === null ? labels.add : 'Zugehörigkeit bearbeiten'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {editingId === null && (
              <div className="space-y-2">
                <Label htmlFor="membership-entity">{labels.entity}</Label>
                <SearchableSelect<string>
                  id="membership-entity"
                  value={entityId || null}
                  onChange={(value) => setEntityId(value ?? '')}
                  options={options}
                  placeholder="Auswählen…"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="membership-role">Rolle</Label>
              <Input
                id="membership-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="z. B. Sänger, TL, Booker"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="membership-notes">Anmerkungen</Label>
              <Input
                id="membership-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleSave}>{editingId === null ? 'Hinzufügen' : 'Speichern'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
