import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { SearchableSelect } from '@/components/ui/searchable-select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { MergeKind } from '../../../../main/api/schemas/merge.schema'

const NOUNS: Record<MergeKind, { one: string; other: string }> = {
  company: { one: 'Firma', other: 'eine andere Firma' },
  person: { one: 'Person', other: 'eine andere Person' },
  venue: { one: 'Club/Festival', other: 'einen anderen Club oder ein anderes Festival' },
  band: { one: 'Band', other: 'eine andere Band' }
}

function useOptions(kind: MergeKind, id: number) {
  const companies = trpcReact.company.getListItems.useQuery(undefined, {
    enabled: kind === 'company'
  })
  const persons = trpcReact.person.getListItems.useQuery(undefined, { enabled: kind === 'person' })
  const venues = trpcReact.venue.getListItems.useQuery(undefined, { enabled: kind === 'venue' })
  const bands = trpcReact.band.getListItems.useQuery(undefined, { enabled: kind === 'band' })
  return useMemo(() => {
    const items =
      kind === 'company'
        ? (companies.data ?? []).map((c) => ({ value: c.id, label: c.name }))
        : kind === 'person'
          ? (persons.data ?? []).map((p) => ({
              value: p.id,
              label: `${p.firstName} ${p.lastName}`.trim()
            }))
          : kind === 'band'
            ? (bands.data ?? []).map((b) => ({ value: b.id, label: b.name }))
            : (venues.data ?? []).map((v) => ({ value: v.id, label: v.name }))
    return items.filter((item) => item.value !== id)
  }, [kind, id, companies.data, persons.data, venues.data, bands.data])
}

/**
 * #249: "Zusammenführen" (in a detail page's "…" menu). The page's record stays; another record of
 * the same kind (picked, or one of the suggested possible duplicates) is merged into it: its
 * events, invoices, memberships, documents and mails move over, differing fields are chosen
 * one by one, and the other record is removed.
 */
export function MergeDialog({
  kind,
  id,
  name,
  onClose
}: {
  kind: MergeKind
  id: number
  name: string
  onClose: () => void
}) {
  const navigate = useNavigate()
  const utils = trpcReact.useUtils()
  const [otherId, setOtherId] = useState<number | null>(null)
  // field keys whose value comes from the other record
  const [take, setTake] = useState<Set<string>>(new Set())
  const options = useOptions(kind, id)
  const candidates = trpcReact.merge.candidates.useQuery({ kind, id })
  const preview = trpcReact.merge.preview.useQuery(
    { kind, keepId: id, dropId: otherId ?? 0 },
    { enabled: otherId !== null }
  )
  const merge = trpcReact.merge.merge.useMutation({
    onSuccess: async () => {
      await utils.invalidate()
      toast.success(`Zusammengeführt in „${name}“`)
      onClose()
      const params = String(id)
      if (kind === 'company')
        void navigate({ to: '/companies/$companyId', params: { companyId: params } })
      else if (kind === 'person')
        void navigate({ to: '/persons/$personId', params: { personId: params } })
      else if (kind === 'band') void navigate({ to: '/band/$bandId', params: { bandId: params } })
      else void navigate({ to: '/venues/$venueId', params: { venueId: params } })
    },
    onError: (error) => toast.error('Zusammenführen fehlgeschlagen', { description: error.message })
  })

  const pick = (next: number | null) => {
    setOtherId(next)
    setTake(new Set())
  }
  const data = preview.data

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>„{name}“ zusammenführen</DialogTitle>
          <DialogDescription>
            Wähle {NOUNS[kind].other}, die dasselbe meint. Alles, was daran hängt, kommt zu „{name}
            “; der andere Eintrag wird danach entfernt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {(candidates.data?.length ?? 0) > 0 && (
            <div className="space-y-1">
              <p className="font-medium">Mögliche Dopplungen</p>
              <ul className="space-y-1">
                {candidates.data!.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      className={
                        candidate.id === otherId
                          ? 'w-full rounded-md border border-primary bg-primary/5 px-2 py-1 text-left'
                          : 'w-full rounded-md border px-2 py-1 text-left hover:bg-muted'
                      }
                      onClick={() => pick(candidate.id)}
                    >
                      {candidate.name}
                      <span className="ml-2 text-xs text-muted-foreground">{candidate.reason}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="merge-other">{NOUNS[kind].one}, die übernommen wird</Label>
            <SearchableSelect
              id="merge-other"
              value={otherId}
              onChange={pick}
              options={options}
              searchPlaceholder="Suchen…"
            />
          </div>

          {preview.error && <p className="text-destructive">{preview.error.message}</p>}

          {data && (
            <div className="space-y-4">
              {data.fields.length > 0 && (
                <div className="space-y-2">
                  <p className="font-medium">Unterschiedliche Angaben – welche bleibt?</p>
                  {data.fields.map((field) => (
                    <fieldset key={field.key} className="rounded-md border p-2">
                      <legend className="px-1 text-xs text-muted-foreground">{field.label}</legend>
                      {(['keep', 'drop'] as const).map((side) => (
                        <label key={side} className="flex items-center gap-2 py-0.5">
                          <input
                            type="radio"
                            className="accent-primary"
                            name={`merge-${field.key}`}
                            checked={side === 'drop' ? take.has(field.key) : !take.has(field.key)}
                            onChange={() =>
                              setTake((current) => {
                                const next = new Set(current)
                                if (side === 'drop') next.add(field.key)
                                else next.delete(field.key)
                                return next
                              })
                            }
                          />
                          <span>{side === 'keep' ? field.keep : field.drop}</span>
                          <span className="text-xs text-muted-foreground">
                            ({side === 'keep' ? data.keep.name : data.drop.name})
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  ))}
                </div>
              )}
              {data.fills.length > 0 && (
                <div className="space-y-1">
                  <p className="font-medium">Wird ergänzt</p>
                  <ul className="list-inside list-disc text-muted-foreground">
                    {data.fills.map((fill) => (
                      <li key={fill.label}>
                        {fill.label}: {fill.value}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="space-y-1">
                <p className="font-medium">Kommt zu „{data.keep.name}“</p>
                <p className="text-muted-foreground">
                  {data.moves.length > 0
                    ? data.moves.map((move) => `${move.count} ${move.label}`).join(', ')
                    : 'Am anderen Eintrag hängt nichts weiter.'}
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            disabled={!data || merge.isPending}
            onClick={() =>
              otherId !== null &&
              merge.mutate({ kind, keepId: id, dropId: otherId, take: [...take] })
            }
          >
            {data ? `„${data.drop.name}“ übernehmen und entfernen` : 'Zusammenführen'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
