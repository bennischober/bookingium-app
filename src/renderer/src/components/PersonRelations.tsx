import { trpcReact } from '@/main'
import { useNavigate } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ExternalLink } from 'lucide-react'

interface PersonRelationsProps {
  personId: number
  personName: string
}

export function PersonRelations({ personId, personName }: PersonRelationsProps) {
  const navigate = useNavigate()
  const relations = trpcReact.relation.getPersonRelations.useQuery({ personId })

  if (relations.isLoading) return <div>Loading relations...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold mb-2">Relations for {personName}</h2>
          <p className="text-sm text-muted-foreground">
            Quick overview of this person's relationships.
          </p>
        </div>
        <Button
          onClick={() => navigate({ to: `/persons/${personId}/relations` })}
          variant="default"
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          Manage Relations
        </Button>
      </div>

      {/* Band Memberships */}
      <Card>
        <CardHeader>
          <CardTitle>Band Memberships</CardTitle>
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
                      <Badge variant="secondary">{membership.role}</Badge>
                    </div>
                    {membership.notes && (
                      <p className="text-sm text-muted-foreground mt-1">{membership.notes}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Company Memberships */}
      <Card>
        <CardHeader>
          <CardTitle>Company Affiliations</CardTitle>
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
                      <Badge variant="secondary">{membership.role}</Badge>
                    </div>
                    {membership.notes && (
                      <p className="text-sm text-muted-foreground mt-1">{membership.notes}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Venue Affiliations */}
      <Card>
        <CardHeader>
          <CardTitle>Venue Affiliations</CardTitle>
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
                    <div className="flex gap-2 mt-1">
                      <Badge variant="secondary">{membership.role}</Badge>
                    </div>
                    {membership.notes && (
                      <p className="text-sm text-muted-foreground mt-1">{membership.notes}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
