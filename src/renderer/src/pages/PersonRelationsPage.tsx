import { useParams, useNavigate } from '@tanstack/react-router'
import { trpcReact } from '@/main'
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
      toast.success('Added to band successfully')
    },
    onError: (error) => toast.error('Failed to add to band', { description: error.message })
  })

  const updateBandMember = trpcReact.relation.updateBandMember.useMutation({
    onSuccess: () => {
      utils.relation.getPersonRelations.invalidate({ personId: Number(personId) })
      closeDialog()
      toast.success('Band membership updated')
    },
    onError: (error) => toast.error('Failed to update', { description: error.message })
  })

  const removeBandMember = trpcReact.relation.removeBandMember.useMutation({
    onSuccess: () => {
      utils.relation.getPersonRelations.invalidate({ personId: Number(personId) })
      toast.success('Removed from band')
    },
    onError: (error) => toast.error('Failed to remove', { description: error.message })
  })

  const addCompanyMember = trpcReact.relation.addCompanyMember.useMutation({
    onSuccess: () => {
      utils.relation.getPersonRelations.invalidate({ personId: Number(personId) })
      closeDialog()
      toast.success('Added to company successfully')
    },
    onError: (error) => toast.error('Failed to add to company', { description: error.message })
  })

  const updateCompanyMember = trpcReact.relation.updateCompanyMember.useMutation({
    onSuccess: () => {
      utils.relation.getPersonRelations.invalidate({ personId: Number(personId) })
      closeDialog()
      toast.success('Company membership updated')
    },
    onError: (error) => toast.error('Failed to update', { description: error.message })
  })

  const removeCompanyMember = trpcReact.relation.removeCompanyMember.useMutation({
    onSuccess: () => {
      utils.relation.getPersonRelations.invalidate({ personId: Number(personId) })
      toast.success('Removed from company')
    },
    onError: (error) => toast.error('Failed to remove', { description: error.message })
  })

  const addVenueMember = trpcReact.relation.addVenueMember.useMutation({
    onSuccess: () => {
      utils.relation.getPersonRelations.invalidate({ personId: Number(personId) })
      closeDialog()
      toast.success('Added to venue successfully')
    },
    onError: (error) => toast.error('Failed to add to venue', { description: error.message })
  })

  const updateVenueMember = trpcReact.relation.updateVenueMember.useMutation({
    onSuccess: () => {
      utils.relation.getPersonRelations.invalidate({ personId: Number(personId) })
      closeDialog()
      toast.success('Venue membership updated')
    },
    onError: (error) => toast.error('Failed to update', { description: error.message })
  })

  const removeVenueMember = trpcReact.relation.removeVenueMember.useMutation({
    onSuccess: () => {
      utils.relation.getPersonRelations.invalidate({ personId: Number(personId) })
      toast.success('Removed from venue')
    },
    onError: (error) => toast.error('Failed to remove', { description: error.message })
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

  const openEditDialog = (type: RelationType, membership: { id: number; role: string; notes: string }) => {
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

  const handleRemove = (type: RelationType, id: number, name: string) => {
    if (!confirm(`Remove from ${name}?`)) return

    if (type === 'band') {
      removeBandMember.mutate({ id })
    } else if (type === 'company') {
      removeCompanyMember.mutate({ id })
    } else {
      removeVenueMember.mutate({ id })
    }
  }

  if (person.isLoading || relations.isLoading) {
    return <div className="p-6">Loading...</div>
  }

  const personName = person.data ? `${person.data.firstName} ${person.data.lastName}` : 'Unknown'

  const getEntityLabel = () => {
    if (dialogType === 'band') return 'Band'
    if (dialogType === 'company') return 'Company'
    return 'Venue'
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
          Back to Persons
        </Button>
        <h1 className="text-2xl font-bold mb-2">Relations for {personName}</h1>
        <p className="text-sm text-muted-foreground">
          Manage this person's relationships with bands, companies, and venues.
        </p>
      </div>

      <div className="space-y-6">
        {/* Band Memberships */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Band Memberships</CardTitle>
            <Button size="sm" variant="outline" onClick={() => openAddDialog('band')}>
              <Plus className="h-4 w-4 mr-2" />
              Add to Band
            </Button>
          </CardHeader>
          <CardContent>
            {relations.data?.bands.length === 0 ? (
              <p className="text-sm text-muted-foreground">No band memberships</p>
            ) : (
              <div className="space-y-3">
                {relations.data?.bands.map((membership) => (
                  <div key={membership.id} className="flex items-center justify-between p-3 border rounded">
                    <div className="flex-1">
                      <p className="font-medium">{membership.bandName}</p>
                      <Badge variant="secondary" className="mt-1">{membership.role}</Badge>
                      {membership.notes && (
                        <p className="text-sm text-muted-foreground mt-1">{membership.notes}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => openEditDialog('band', membership)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleRemove('band', membership.id, membership.bandName)}>
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
            <CardTitle>Company Affiliations</CardTitle>
            <Button size="sm" variant="outline" onClick={() => openAddDialog('company')}>
              <Plus className="h-4 w-4 mr-2" />
              Add to Company
            </Button>
          </CardHeader>
          <CardContent>
            {relations.data?.companies.length === 0 ? (
              <p className="text-sm text-muted-foreground">No company affiliations</p>
            ) : (
              <div className="space-y-3">
                {relations.data?.companies.map((membership) => (
                  <div key={membership.id} className="flex items-center justify-between p-3 border rounded">
                    <div className="flex-1">
                      <p className="font-medium">{membership.companyName}</p>
                      <Badge variant="secondary" className="mt-1">{membership.role}</Badge>
                      {membership.notes && (
                        <p className="text-sm text-muted-foreground mt-1">{membership.notes}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => openEditDialog('company', membership)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleRemove('company', membership.id, membership.companyName)}>
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
            <CardTitle>Venue Affiliations</CardTitle>
            <Button size="sm" variant="outline" onClick={() => openAddDialog('venue')}>
              <Plus className="h-4 w-4 mr-2" />
              Add to Venue
            </Button>
          </CardHeader>
          <CardContent>
            {relations.data?.venues.length === 0 ? (
              <p className="text-sm text-muted-foreground">No venue affiliations</p>
            ) : (
              <div className="space-y-3">
                {relations.data?.venues.map((membership) => (
                  <div key={membership.id} className="flex items-center justify-between p-3 border rounded">
                    <div className="flex-1">
                      <p className="font-medium">{membership.venueName}</p>
                      <Badge variant="secondary" className="mt-1">{membership.role}</Badge>
                      {membership.notes && (
                        <p className="text-sm text-muted-foreground mt-1">{membership.notes}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => openEditDialog('venue', membership)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleRemove('venue', membership.id, membership.venueName)}>
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
              {dialogMode === 'add' ? 'Add' : 'Edit'} {getEntityLabel()} Membership
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
                    <SelectValue placeholder="Select..." />
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
              <Label>Role</Label>
              <Input
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                placeholder="e.g., Lead Vocalist, Manager, Stage Manager"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Additional notes..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={dialogMode === 'add' && !formData.entityId}>
              {dialogMode === 'add' ? 'Add' : 'Update'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
