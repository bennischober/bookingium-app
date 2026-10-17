import { useParams, useNavigate } from '@tanstack/react-router'
import { trpcReact } from '@/lib/trpc'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, ArrowLeft, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
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
import { confirmAction } from '@/lib/confirm'

type RelationType = 'band' | 'company' | 'venue'
type DialogMode = 'add' | 'edit'

interface FormData {
  entityId: string
  role: string
  notes: string
}

export default function PersonRelationsPage() {
  const { personId } = useParams({ strict: false })
  const navigate = useNavigate()
  const utils = trpcReact.useUtils()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<DialogMode>('add')
  const [dialogType, setDialogType] = useState<RelationType>('band')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formData, setFormData] = useState<FormData>({ entityId: '', role: '', notes: '' })

  // Queries
  const person = trpcReact.person.getById.useQuery({ id: Number(personId) })
  const relations = trpcReact.relation.getPersonRelations.useQuery({ personId: Number(personId) })
  const allBands = trpcReact.band.getAll.useQuery()
  const allCompanies = trpcReact.company.getAll.useQuery()
  const allVenues = trpcReact.venue.getAll.useQuery()

  // Mutations
  const addBandMember = trpcReact.relation.addBandMember.useMutation({
    onSuccess: () => {
      utils.relation.getPersonRelations.invalidate({ personId: Number(personId) })
      closeDialog()
      toast.success('Erfolgreich zur Band hinzugefügt')
    },
    onError: (error) =>
      toast.error('Hinzufügen zur Band fehlgeschlagen', { description: error.message })
  })

  const updateBandMember = trpcReact.relation.updateBandMember.useMutation({
    onSuccess: () => {
      utils.relation.getPersonRelations.invalidate({ personId: Number(personId) })
      closeDialog()
      toast.success('Bandmitgliedschaft aktualisiert')
    },
    onError: (error) => toast.error('Aktualisierung fehlgeschlagen', { description: error.message })
  })

  const removeBandMember = trpcReact.relation.removeBandMember.useMutation({
    onSuccess: () => {
      utils.relation.getPersonRelations.invalidate({ personId: Number(personId) })
      toast.success('Aus der Band entfernt')
    },
    onError: (error) => toast.error('Entfernen fehlgeschlagen', { description: error.message })
  })

  const addCompanyMember = trpcReact.relation.addCompanyMember.useMutation({
    onSuccess: () => {
      utils.relation.getPersonRelations.invalidate({ personId: Number(personId) })
      closeDialog()
      toast.success('Erfolgreich zur Firma hinzugefügt')
    },
    onError: (error) =>
      toast.error('Hinzufügen zur Firma fehlgeschlagen', { description: error.message })
  })

  const updateCompanyMember = trpcReact.relation.updateCompanyMember.useMutation({
    onSuccess: () => {
      utils.relation.getPersonRelations.invalidate({ personId: Number(personId) })
      closeDialog()
      toast.success('Firmenzugehörigkeit aktualisiert')
    },
    onError: (error) => toast.error('Aktualisierung fehlgeschlagen', { description: error.message })
  })

  const removeCompanyMember = trpcReact.relation.removeCompanyMember.useMutation({
    onSuccess: () => {
      utils.relation.getPersonRelations.invalidate({ personId: Number(personId) })
      toast.success('Aus der Firma entfernt')
    },
    onError: (error) => toast.error('Entfernen fehlgeschlagen', { description: error.message })
  })

  const addVenueMember = trpcReact.relation.addVenueMember.useMutation({
    onSuccess: () => {
      utils.relation.getPersonRelations.invalidate({ personId: Number(personId) })
      closeDialog()
      toast.success('Erfolgreich zur Spielstätte hinzugefügt')
    },
    onError: (error) =>
      toast.error('Hinzufügen zur Spielstätte fehlgeschlagen', { description: error.message })
  })

  const updateVenueMember = trpcReact.relation.updateVenueMember.useMutation({
    onSuccess: () => {
      utils.relation.getPersonRelations.invalidate({ personId: Number(personId) })
      closeDialog()
      toast.success('Spielstättenzugehörigkeit aktualisiert')
    },
    onError: (error) => toast.error('Aktualisierung fehlgeschlagen', { description: error.message })
  })

  const removeVenueMember = trpcReact.relation.removeVenueMember.useMutation({
    onSuccess: () => {
      utils.relation.getPersonRelations.invalidate({ personId: Number(personId) })
      toast.success('Von der Spielstätte entfernt')
    },
    onError: (error) => toast.error('Entfernen fehlgeschlagen', { description: error.message })
  })

  // Dialog handlers
  const closeDialog = () => {
    setDialogOpen(false)
    setFormData({ entityId: '', role: '', notes: '' })
    setEditingId(null)
  }

  const openAddDialog = (type: RelationType) => {
    setDialogType(type)
    setDialogMode('add')
    setFormData({ entityId: '', role: '', notes: '' })
    setDialogOpen(true)
  }

  const openEditDialog = (
    type: RelationType,
    membership: { id: number; role: string; notes: string }
  ) => {
    setDialogType(type)
    setDialogMode('edit')
    setEditingId(membership.id)
    setFormData({
      entityId: '',
      role: membership.role,
      notes: membership.notes
    })
    setDialogOpen(true)
  }

  const handleSubmit = () => {
    const personIdNum = Number(personId)

    if (dialogMode === 'add') {
      const baseData = {
        personId: personIdNum,
        role: formData.role,
        notes: formData.notes
      }

      if (dialogType === 'band') {
        addBandMember.mutate({ ...baseData, bandId: Number(formData.entityId) })
      } else if (dialogType === 'company') {
        addCompanyMember.mutate({ ...baseData, companyId: Number(formData.entityId) })
      } else {
        addVenueMember.mutate({ ...baseData, venueId: Number(formData.entityId) })
      }
    } else {
      const updateData = {
        id: editingId!,
        role: formData.role,
        notes: formData.notes
      }

      if (dialogType === 'band') {
        updateBandMember.mutate(updateData)
      } else if (dialogType === 'company') {
        updateCompanyMember.mutate(updateData)
      } else {
        updateVenueMember.mutate(updateData)
      }
    }
  }

  const handleRemove = async (type: RelationType, id: number, name: string) => {
    const confirmed = await confirmAction({
      title: `Aus ${name} entfernen?`,
      confirmLabel: 'Entfernen',
      destructive: true
    })
    if (!confirmed) return

    if (type === 'band') {
      removeBandMember.mutate({ id })
    } else if (type === 'company') {
      removeCompanyMember.mutate({ id })
    } else {
      removeVenueMember.mutate({ id })
    }
  }

  if (person.isLoading || relations.isLoading) {
    return <div className="p-6">Lädt...</div>
  }

  const personName = person.data ? `${person.data.firstName} ${person.data.lastName}` : 'Unbekannt'

  const getEntityLabel = () => {
    if (dialogType === 'band') return 'Band'
    if (dialogType === 'company') return 'Firma'
    return 'Spielstätte'
  }

  const getEntityOptions = () => {
    if (dialogType === 'band') return allBands.data || []
    if (dialogType === 'company') return allCompanies.data || []
    return allVenues.data || []
  }

  return (
    <div className="flex flex-col w-full h-full p-6">
      <div className="mb-6">
        <Button variant="ghost" onClick={() => navigate({ to: '/persons' })} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Zurück zu Personen
        </Button>
        <h1 className="text-2xl font-bold mb-2">Beziehungen von {personName}</h1>
        <p className="text-sm text-muted-foreground">
          Verwalten Sie die Beziehungen dieser Person zu Bands, Firmen und Spielstätten.
        </p>
      </div>

      <div className="space-y-6">
        {/* Band Memberships */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Bandmitgliedschaften</CardTitle>
            <Button size="sm" variant="outline" onClick={() => openAddDialog('band')}>
              <Plus className="h-4 w-4 mr-2" />
              Zur Band hinzufügen
            </Button>
          </CardHeader>
          <CardContent>
            {relations.data?.bands.length === 0 ? (
              <p className="text-sm text-muted-foreground">Keine Bandmitgliedschaften</p>
            ) : (
              <div className="space-y-3">
                {relations.data?.bands.map((membership) => (
                  <div
                    key={membership.id}
                    className="flex items-center justify-between p-3 border rounded"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{membership.bandName}</p>
                      <Badge variant="secondary" className="mt-1">
                        {membership.role}
                      </Badge>
                      {membership.notes && (
                        <p className="text-sm text-muted-foreground mt-1">{membership.notes}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog('band', membership)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove('band', membership.id, membership.bandName)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Company Memberships */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Firmenzugehörigkeiten</CardTitle>
            <Button size="sm" variant="outline" onClick={() => openAddDialog('company')}>
              <Plus className="h-4 w-4 mr-2" />
              Zur Firma hinzufügen
            </Button>
          </CardHeader>
          <CardContent>
            {relations.data?.companies.length === 0 ? (
              <p className="text-sm text-muted-foreground">Keine Firmenzugehörigkeiten</p>
            ) : (
              <div className="space-y-3">
                {relations.data?.companies.map((membership) => (
                  <div
                    key={membership.id}
                    className="flex items-center justify-between p-3 border rounded"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{membership.companyName}</p>
                      <Badge variant="secondary" className="mt-1">
                        {membership.role}
                      </Badge>
                      {membership.notes && (
                        <p className="text-sm text-muted-foreground mt-1">{membership.notes}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog('company', membership)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          handleRemove('company', membership.id, membership.companyName)
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Venue Affiliations */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Spielstättenzugehörigkeiten</CardTitle>
            <Button size="sm" variant="outline" onClick={() => openAddDialog('venue')}>
              <Plus className="h-4 w-4 mr-2" />
              Zur Spielstätte hinzufügen
            </Button>
          </CardHeader>
          <CardContent>
            {relations.data?.venues.length === 0 ? (
              <p className="text-sm text-muted-foreground">Keine Spielstättenzugehörigkeiten</p>
            ) : (
              <div className="space-y-3">
                {relations.data?.venues.map((membership) => (
                  <div
                    key={membership.id}
                    className="flex items-center justify-between p-3 border rounded"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{membership.venueName}</p>
                      <Badge variant="secondary" className="mt-1">
                        {membership.role}
                      </Badge>
                      {membership.notes && (
                        <p className="text-sm text-muted-foreground mt-1">{membership.notes}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog('venue', membership)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove('venue', membership.id, membership.venueName)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'add' ? 'Hinzufügen' : 'Bearbeiten'}: {getEntityLabel()}-Zugehörigkeit
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {dialogMode === 'add' && (
              <div>
                <Label>{getEntityLabel()}</Label>
                <Select
                  value={formData.entityId}
                  onValueChange={(value) => setFormData({ ...formData, entityId: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Auswählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {getEntityOptions().map((entity) => (
                      <SelectItem key={entity.id} value={entity.id.toString()}>
                        {entity.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Rolle</Label>
              <Input
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                placeholder="z. B. Sänger/in, Manager, Bühnenmanager"
              />
            </div>
            <div>
              <Label>Anmerkungen</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Weitere Anmerkungen..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Abbrechen
            </Button>
            <Button onClick={handleSubmit} disabled={dialogMode === 'add' && !formData.entityId}>
              {dialogMode === 'add' ? 'Hinzufügen' : 'Aktualisieren'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
