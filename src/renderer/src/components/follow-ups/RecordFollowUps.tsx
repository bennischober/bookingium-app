import { useState } from 'react'
import { BellPlus } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { FollowUpDialog } from './FollowUpDialog'
import { FollowUpList } from './FollowUpList'
import type { FollowUpRecord } from '../../../../main/api/schemas/followUp.schema'

type RecordProps = { record: FollowUpRecord & { name: string } }

/** "Wiedervorlage" button for a detail page header */
export function FollowUpButton({ record }: RecordProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={() => setOpen(true)}
        title="Wiedervorlage anlegen"
      >
        <BellPlus className="h-3.5 w-3.5" />
        Wiedervorlage
      </Button>
      <FollowUpDialog open={open} onOpenChange={setOpen} record={record} />
    </>
  )
}

/** The record's open follow-ups above its tabs; nothing when there are none */
export function RecordFollowUps({ record }: RecordProps) {
  const query = trpcReact.followUp.listOpenByRecord.useQuery({ type: record.type, id: record.id })
  const followUps = query.data ?? []
  if (followUps.length === 0) return null

  return (
    <section
      aria-label="Wiedervorlagen"
      className="mb-6 max-w-2xl rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 dark:border-amber-900/60 dark:bg-amber-950/20"
    >
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Wiedervorlagen
      </h2>
      <FollowUpList followUps={followUps} />
    </section>
  )
}
