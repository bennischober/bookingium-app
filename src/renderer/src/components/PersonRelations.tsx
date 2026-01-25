import { trpcReact } from '@/main'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus } from 'lucide-react'

interface PersonRelationsProps {
  personId: number
  personName: string
}

export function PersonRelations({ personId, personName }: PersonRelationsProps) {
  const relations = trpcReact.person.getRelations.useQuery({ id: personId })

  if (relations.isLoading) return <div>Loading relations...</div>

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-4">Relations for {personName}</h2>
        <p className="text-sm text-muted-foreground mb-6">
          View and manage this person's relationships with bands, companies, and venues.
        </p>
      </div>

      {/* Band Memberships */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Band Memberships</CardTitle>
          <Button size="sm" variant="outline">
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
                <div
                  key={membership.id}
                  className="flex items-center justify-between p-3 border rounded"
                >
                  <div>
                    <p className="font-medium">{membership.bandName}</p>
                    <div className="flex gap-2 mt-1">
                      <Badge variant="secondary">{membership.role || 'No role'}</Badge>
                    </div>
                    {membership.notes && (
                      <p className="text-sm text-muted-foreground mt-1">{membership.notes}</p>
                    )}
                  </div>
                  <Button variant="ghost" size="sm">
                    Edit
                  </Button>
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
          <Button size="sm" variant="outline">
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
                <div
                  key={membership.id}
                  className="flex items-center justify-between p-3 border rounded"
                >
                  <div>
                    <p className="font-medium">{membership.companyName}</p>
                    <div className="flex gap-2 mt-1">
                      <Badge variant="secondary">{membership.role || 'No role'}</Badge>
                    </div>
                    {membership.notes && (
                      <p className="text-sm text-muted-foreground mt-1">{membership.notes}</p>
                    )}
                  </div>
                  <Button variant="ghost" size="sm">
                    Edit
                  </Button>
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
          <Button size="sm" variant="outline">
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
                <div
                  key={membership.id}
                  className="flex items-center justify-between p-3 border rounded"
                >
                  <div>
                    <p className="font-medium">{membership.venueName}</p>
                    <Badge variant="secondary" className="mt-1">
                      {membership.role || 'No role'}
                    </Badge>
                  </div>
                  <Button variant="ghost" size="sm">
                    Edit
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
