import { SearchableSelect } from '@/components/ui/searchable-select'
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Plus, Pencil, Trash2, Users } from 'lucide-react'
import { toast } from '@/lib/toast'
import { ErrorState, LoadingRow } from '@/components/load-states'
import { TabHeader } from '@/components/detail/DetailParts'
import { CARD_GRID } from '@/components/detail/tabStyles'
import { countLabel } from '@/components/detail/tableSort'
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
import { COMPANY_MEMBER_ROLE_SUGGESTIONS } from '../../../main/api/schemas/einvoice_party.schema'
import { t } from '../../../main/i18n/translate'

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
  band: { one: t('Mitglied'), many: t('Mitglieder'), edit: t('Mitgliedschaft') },
  company: { one: t('Ansprechpartner'), many: t('Ansprechpartner'), edit: t('Ansprechpartner') },
  venue: { one: t('Ansprechpartner'), many: t('Ansprechpartner'), edit: t('Ansprechpartner') }
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
    entityType === 'band' ? t('Band') : entityType === 'company' ? t('Firma') : t('Club / Festival')
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
      toast.success(t('{{one}} hinzugefügt', { one: nouns.one }))
    },
    onError: (e) => toast.error(t('Hinzufügen fehlgeschlagen'), { description: e.message })
  })
  const addCompanyMutation = trpcReact.relation.addCompanyMember.useMutation({
    onSuccess: () => {
      invalidate()
      setDialogOpen(false)
      toast.success(t('{{one}} hinzugefügt', { one: nouns.one }))
    },
    onError: (e) => toast.error(t('Hinzufügen fehlgeschlagen'), { description: e.message })
  })
  const addVenueMutation = trpcReact.relation.addVenueMember.useMutation({
    onSuccess: () => {
      invalidate()
      setDialogOpen(false)
      toast.success(t('{{one}} hinzugefügt', { one: nouns.one }))
    },
    onError: (e) => toast.error(t('Hinzufügen fehlgeschlagen'), { description: e.message })
  })

  const updateMutation = trpcReact.relation.updateBandMember.useMutation({
    onSuccess: () => {
      invalidate()
      setDialogOpen(false)
      toast.success(`${nouns.edit} aktualisiert`)
    },
    onError: (e) => toast.error(t('Aktualisierung fehlgeschlagen'), { description: e.message })
  })
  const updateCompanyMutation = trpcReact.relation.updateCompanyMember.useMutation({
    onSuccess: () => {
      invalidate()
      setDialogOpen(false)
      toast.success(`${nouns.edit} aktualisiert`)
    },
    onError: (e) => toast.error(t('Aktualisierung fehlgeschlagen'), { description: e.message })
  })
  const updateVenueMutation = trpcReact.relation.updateVenueMember.useMutation({
    onSuccess: () => {
      invalidate()
      setDialogOpen(false)
      toast.success(`${nouns.edit} aktualisiert`)
    },
    onError: (e) => toast.error(t('Aktualisierung fehlgeschlagen'), { description: e.message })
  })

  const removeMutation = trpcReact.relation.removeBandMember.useMutation({
    onSuccess: () => {
      invalidate()
      toast.success(`${nouns.one} entfernt`)
    },
    onError: (e) => toast.error(t('Entfernen fehlgeschlagen'), { description: e.message })
  })
  const removeCompanyMutation = trpcReact.relation.removeCompanyMember.useMutation({
    onSuccess: () => {
      invalidate()
      toast.success(`${nouns.one} entfernt`)
    },
    onError: (e) => toast.error(t('Entfernen fehlgeschlagen'), { description: e.message })
  })
  const removeVenueMutation = trpcReact.relation.removeVenueMember.useMutation({
    onSuccess: () => {
      invalidate()
      toast.success(`${nouns.one} entfernt`)
    },
    onError: (e) => toast.error(t('Entfernen fehlgeschlagen'), { description: e.message })
  })

  const members: MemberRow[] =
    entityType === 'band'
      ? (membersQuery.data ?? []).map((m) => ({
          id: m.id,
          personId: m.personId,
          personName: m.personName ?? t('Person #{{personId}}', { personId: m.personId }),
          role: m.role,
          notes: m.notes
        }))
      : entityType === 'company'
        ? (companyMembersQuery.data ?? []).map((m) => ({
            id: m.id,
            personId: m.personId,
            personName: m.personName ?? t('Person #{{personId}}', { personId: m.personId }),
            role: m.role,
            notes: m.notes
          }))
        : (venueMembersQuery.data ?? []).map((m) => ({
            id: m.id,
            personId: m.personId,
            personName: m.personName ?? t('Person #{{personId}}', { personId: m.personId }),
            role: m.role,
            notes: m.notes
          }))

  const membersOf =
    entityType === 'band'
      ? membersQuery
      : entityType === 'company'
        ? companyMembersQuery
        : venueMembersQuery

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
      toast.error(t('Bitte eine Person auswählen'))
      return
    }

    if (editingId === null) {
      if (!role.trim()) {
        toast.error(t('Bitte eine Rolle angeben'))
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
      title: t('{{personName}} aus der {{entityLabel}} entfernen?', {
        personName: member.personName,
        entityLabel
      }),
      confirmLabel: t('Entfernen'),
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
        <TabHeader
          summary={
            membersOf.data
              ? members.length === 0
                ? t('Noch keine {{many}}.', { many: nouns.many })
                : countLabel(members.length, nouns.one, nouns.many)
              : undefined
          }
        >
          <Button size="sm" onClick={openAdd} className="gap-1.5">
            <Plus className="h-4 w-4" />
            {t('Person hinzufügen')}
          </Button>
        </TabHeader>

        {membersOf.isLoading ? (
          <LoadingRow>
            {nouns.many} {t('werden geladen…')}
          </LoadingRow>
        ) : membersOf.isError ? (
          <ErrorState error={membersOf.error} onRetry={() => void membersOf.refetch()} />
        ) : members.length === 0 ? null : (
          <div className={CARD_GRID}>
            {members.map((member) => (
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
                    title={t('Rolle bearbeiten')}
                    aria-label={t('Rolle von {{personName}} bearbeiten', {
                      personName: member.personName
                    })}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(member)}
                    title={t('Entfernen')}
                    aria-label={`${member.personName} entfernen`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId === null
                ? t('Zur {{entityLabel}} hinzufügen', { entityLabel })
                : `${nouns.edit} bearbeiten`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {editingId === null && (
              <div className="space-y-2">
                <Label htmlFor="member-person">{t('Person')}</Label>
                <SearchableSelect<string>
                  id="member-person"
                  value={personId || null}
                  onChange={(value) => setPersonId(value ?? '')}
                  options={(persons.data ?? []).map((p) => ({
                    value: p.id.toString(),
                    label: `${p.firstName} ${p.lastName}`.trim()
                  }))}
                  placeholder={t('Person auswählen')}
                  searchPlaceholder={t('Person suchen…')}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>{t('Rolle')}</Label>
              <Input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                list={entityType === 'company' ? 'company-member-roles' : undefined}
                placeholder={
                  entityType === 'company'
                    ? t('z. B. Kontakt, Geschäftsführer')
                    : t('z. B. Sänger, TL, Booker')
                }
              />
              {/* #222: common roles of a company's people; the role stays free text */}
              {entityType === 'company' && (
                <datalist id="company-member-roles">
                  {COMPANY_MEMBER_ROLE_SUGGESTIONS.map((suggestion) => (
                    <option key={suggestion} value={suggestion} />
                  ))}
                </datalist>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t('Anmerkungen')}</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('Abbrechen')}
            </Button>
            <Button onClick={handleSave}>
              {editingId === null ? t('Hinzufügen') : t('Speichern')}
            </Button>
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
    entityType === 'band' ? t('Band') : entityType === 'company' ? t('Firma') : t('Club / Festival')

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[520px] sm:max-w-[520px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            {MEMBER_NOUNS[entityType].many}: {entityName}
          </SheetTitle>
          <SheetDescription>
            {t('Personen, die dieser')} {entityLabel} zugeordnet sind.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 px-4">
          <MembersPanel entityType={entityType} entityId={entityId} open={open} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
