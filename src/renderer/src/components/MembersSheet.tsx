import { SearchableSelect } from '@/components/ui/searchable-select'
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Plus, Pencil, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import { confirmAction } from '@/lib/confirm'

type MemberEntityType = 'band' | 'company' | 'venue'

type MemberRow = {
  id: number
  personId: number
  personName: string
  role: string | null
  notes: string | null
}

/**
 * Persons assigned to a band/company/venue, with add/edit-role/remove.
 * Reuses the relation router's member CRUD from the entity side (the person
 * page's PersonMembershipsPanel covers the person side). Names link to the
 * person page. Shown in MembersSheet and on detail pages.
 */
/** What one person in the panel is called: a band has members, a company or venue contacts */
const MEMBER_NOUNS: Record<MemberEntityType, { one: string; many: string; edit: string }> = {
  band: { one: 'Mitglied', many: 'Mitglieder', edit: 'Mitgliedschaft' },
  company: { one: 'Ansprechpartner', many: 'Ansprechpartner', edit: 'Ansprechpartner' },
  venue: { one: 'Ansprechpartner', many: 'Ansprechpartner', edit: 'Ansprechpartner' }
}

export function MembersPanel({
  entityType,
  entityId,
  open = true
}: {
  entityType: MemberEntityType
  entityId: number | null
  // Queries only run while shown
  open?: boolean
}) {
  const entityLabel =
    entityType === 'band' ? 'Band' : entityType === 'company' ? 'Firma' : 'Spielstätte'
  const nouns = MEMBER_NOUNS[entityType]
  const utils = trpcReact.useUtils()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [personId, setPersonId] = useState<string>('')
  const [role, setRole] = useState('')
  const [notes, setNotes] = useState('')

  const membersQuery = trpcReact.relation.getBandMembers.useQuery(
    { bandId: entityId ?? 0 },
    { enabled: open && entityType === 'band' && entityId !== null }
  )
  const companyMembersQuery = trpcReact.relation.getCompanyMembers.useQuery(
    { companyId: entityId ?? 0 },
    { enabled: open && entityType === 'company' && entityId !== null }
  )
  const venueMembersQuery = trpcReact.relation.getVenueMembers.useQuery(
    { venueId: entityId ?? 0 },
    { enabled: open && entityType === 'venue' && entityId !== null }
  )

  const persons = trpcReact.person.getListItems.useQuery()

  const invalidate = () => {
    if (entityType === 'band' && entityId) {
      utils.relation.getBandMembers.invalidate({ bandId: entityId })
    } else if (entityType === 'company' && entityId) {
      utils.relation.getCompanyMembers.invalidate({ companyId: entityId })
    } else if (entityType === 'venue' && entityId) {
      utils.relation.getVenueMembers.invalidate({ venueId: entityId })
    }
  }

  const addMutation = trpcReact.relation.addBandMember.useMutation({
    onSuccess: () => {
      invalidate()
      setDialogOpen(false)
      toast.success(`${nouns.one} hinzugefügt`)
    },
    onError: (e) => toast.error('Hinzufügen fehlgeschlagen', { description: e.message })
  })
  const addCompanyMutation = trpcReact.relation.addCompanyMember.useMutation({
    onSuccess: () => {
      invalidate()
      setDialogOpen(false)
      toast.success(`${nouns.one} hinzugefügt`)
    },
    onError: (e) => toast.error('Hinzufügen fehlgeschlagen', { description: e.message })
  })
  const addVenueMutation = trpcReact.relation.addVenueMember.useMutation({
    onSuccess: () => {
      invalidate()
      setDialogOpen(false)
      toast.success(`${nouns.one} hinzugefügt`)
    },
    onError: (e) => toast.error('Hinzufügen fehlgeschlagen', { description: e.message })
  })

  const updateMutation = trpcReact.relation.updateBandMember.useMutation({
    onSuccess: () => {
      invalidate()
      setDialogOpen(false)
      toast.success(`${nouns.edit} aktualisiert`)
    },
    onError: (e) => toast.error('Aktualisierung fehlgeschlagen', { description: e.message })
  })
  const updateCompanyMutation = trpcReact.relation.updateCompanyMember.useMutation({
    onSuccess: () => {
      invalidate()
      setDialogOpen(false)
      toast.success(`${nouns.edit} aktualisiert`)
    },
    onError: (e) => toast.error('Aktualisierung fehlgeschlagen', { description: e.message })
  })
  const updateVenueMutation = trpcReact.relation.updateVenueMember.useMutation({
    onSuccess: () => {
      invalidate()
      setDialogOpen(false)
      toast.success(`${nouns.edit} aktualisiert`)
    },
    onError: (e) => toast.error('Aktualisierung fehlgeschlagen', { description: e.message })
  })

  const removeMutation = trpcReact.relation.removeBandMember.useMutation({
    onSuccess: () => {
      invalidate()
      toast.success(`${nouns.one} entfernt`)
    },
    onError: (e) => toast.error('Entfernen fehlgeschlagen', { description: e.message })
  })
  const removeCompanyMutation = trpcReact.relation.removeCompanyMember.useMutation({
    onSuccess: () => {
      invalidate()
      toast.success(`${nouns.one} entfernt`)
    },
    onError: (e) => toast.error('Entfernen fehlgeschlagen', { description: e.message })
  })
  const removeVenueMutation = trpcReact.relation.removeVenueMember.useMutation({
    onSuccess: () => {
      invalidate()
      toast.success(`${nouns.one} entfernt`)
    },
    onError: (e) => toast.error('Entfernen fehlgeschlagen', { description: e.message })
  })

  const members: MemberRow[] =
    entityType === 'band'
      ? (membersQuery.data ?? []).map((m) => ({
          id: m.id,
          personId: m.personId,
          personName: m.personName ?? `Person #${m.personId}`,
          role: m.role,
          notes: m.notes
        }))
      : entityType === 'company'
        ? (companyMembersQuery.data ?? []).map((m) => ({
            id: m.id,
            personId: m.personId,
            personName: m.personName ?? `Person #${m.personId}`,
            role: m.role,
            notes: m.notes
          }))
        : (venueMembersQuery.data ?? []).map((m) => ({
            id: m.id,
            personId: m.personId,
            personName: m.personName ?? `Person #${m.personId}`,
            role: m.role,
            notes: m.notes
          }))

  const isLoading =
    (entityType === 'band' && membersQuery.isLoading) ||
    (entityType === 'company' && companyMembersQuery.isLoading) ||
    (entityType === 'venue' && venueMembersQuery.isLoading)

  const openAdd = () => {
    setEditingId(null)
    setPersonId('')
    setRole('')
    setNotes('')
    setDialogOpen(true)
  }

  const openEdit = (member: MemberRow) => {
    setEditingId(member.id)
    setPersonId(member.personId.toString())
    setRole(member.role ?? '')
    setNotes(member.notes ?? '')
    setDialogOpen(true)
  }

  const handleSave = () => {
    if (editingId === null && !personId) {
      toast.error('Bitte eine Person auswählen')
      return
    }

    if (editingId === null) {
      if (!role.trim()) {
        toast.error('Bitte eine Rolle angeben')
        return
      }
      const baseData = { role: role.trim(), notes: notes || '' }
      if (entityType === 'band') {
        addMutation.mutate({ bandId: entityId!, personId: Number(personId), ...baseData })
      } else if (entityType === 'company') {
        addCompanyMutation.mutate({ companyId: entityId!, personId: Number(personId), ...baseData })
      } else {
        addVenueMutation.mutate({ venueId: entityId!, personId: Number(personId), ...baseData })
      }
      return
    }

    const updateData = { id: editingId, role: role.trim() || undefined, notes: notes || undefined }
    if (entityType === 'band') {
      updateMutation.mutate(updateData)
    } else if (entityType === 'company') {
      updateCompanyMutation.mutate(updateData)
    } else {
      updateVenueMutation.mutate(updateData)
    }
  }

  const handleRemove = async (member: MemberRow) => {
    const confirmed = await confirmAction({
      title: `${member.personName} aus der ${entityLabel} entfernen?`,
      confirmLabel: 'Entfernen',
      destructive: true
    })
    if (!confirmed) return
    if (entityType === 'band') {
      removeMutation.mutate({ id: member.id })
    } else if (entityType === 'company') {
      removeCompanyMutation.mutate({ id: member.id })
    } else {
      removeVenueMutation.mutate({ id: member.id })
    }
  }

  return (
    <>
      <div className="space-y-3">
        <Button size="sm" variant="outline" onClick={openAdd} className="w-full">
          <Plus className="h-4 w-4 mr-2" />
          Person hinzufügen
        </Button>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{nouns.many} werden geladen…</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine {nouns.many}.</p>
        ) : (
          members.map((member) => (
            <div key={member.id} className="flex items-center justify-between p-3 border rounded">
              <div className="flex-1 min-w-0">
                <Link
                  to="/persons/$personId"
                  params={{ personId: String(member.personId) }}
                  className="block truncate font-medium hover:underline"
                >
                  {member.personName}
                </Link>
                {member.role && (
                  <Badge variant="secondary" className="mt-1">
                    {member.role}
                  </Badge>
                )}
                {member.notes && (
                  <p className="text-xs text-muted-foreground mt-1">{member.notes}</p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(member)}
                  title="Rolle bearbeiten"
                  aria-label={`Rolle von ${member.personName} bearbeiten`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(member)}
                  title="Entfernen"
                  aria-label={`${member.personName} entfernen`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId === null ? `Zur ${entityLabel} hinzufügen` : `${nouns.edit} bearbeiten`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {editingId === null && (
              <div className="space-y-2">
                <Label htmlFor="member-person">Person</Label>
                <SearchableSelect<string>
                  id="member-person"
                  value={personId || null}
                  onChange={(value) => setPersonId(value ?? '')}
                  options={(persons.data ?? []).map((p) => ({
                    value: p.id.toString(),
                    label: `${p.firstName} ${p.lastName}`.trim()
                  }))}
                  placeholder="Person auswählen"
                  searchPlaceholder="Person suchen…"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Rolle</Label>
              <Input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="z. B. Sänger, TL, Booker"
              />
            </div>
            <div className="space-y-2">
              <Label>Anmerkungen</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
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

/** Side sheet with the members of a band/company/venue */
export function MembersSheet({
  entityType,
  entityId,
  entityName,
  open,
  onOpenChange
}: {
  entityType: MemberEntityType
  entityId: number | null
  entityName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const entityLabel =
    entityType === 'band' ? 'Band' : entityType === 'company' ? 'Firma' : 'Spielstätte'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[520px] sm:max-w-[520px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            {MEMBER_NOUNS[entityType].many}: {entityName}
          </SheetTitle>
          <SheetDescription>Personen, die dieser {entityLabel} zugeordnet sind.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 px-4">
          <MembersPanel entityType={entityType} entityId={entityId} open={open} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
