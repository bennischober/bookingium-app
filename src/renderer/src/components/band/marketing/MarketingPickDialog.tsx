import { useState } from 'react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  MARKETING_STATUS_LABELS,
  type MarketingItemDto
} from '../../../../../main/api/schemas/marketing.schema'
import { AtlasPicker, type PickerEntry } from './AtlasPicker'
import { t } from '../../../../../main/i18n/translate'

/** The entries the picker offers: everything still in the atlas, and what is on the list anyway */
function entriesOf(items: MarketingItemDto[]): PickerEntry[] {
  return items
    .filter((item) => item.inAtlas || item.picked)
    .map((item) => ({
      key: String(item.id),
      category: item.category,
      group: item.group,
      name: item.name,
      country: item.country,
      type: item.type,
      priority: item.priority,
      quality: item.quality,
      reason: item.reason,
      note: item.status !== 'open' ? MARKETING_STATUS_LABELS[item.status] : undefined
    }))
}

/**
 * "Auswahl bearbeiten": which atlas entries are on the band's working list. Entries taken off
 * keep their status and note and wait in the pool.
 */
export function MarketingPickDialog({
  bandId,
  items,
  open,
  onOpenChange
}: {
  bandId: number
  items: MarketingItemDto[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const utils = trpcReact.useUtils()
  const [selected, setSelected] = useState(
    () => new Set(items.filter((item) => item.picked).map((item) => String(item.id)))
  )
  const [createContacts, setCreateContacts] = useState(true)
  const setPicked = trpcReact.marketing.setPicked.useMutation()
  const entries = entriesOf(items)
  const added = items.filter((item) => !item.picked && selected.has(String(item.id)))
  const removed = items.filter((item) => item.picked && !selected.has(String(item.id)))

  const save = async () => {
    try {
      const [add, remove] = await Promise.all([
        setPicked.mutateAsync({
          bandId,
          ids: added.map((item) => item.id),
          picked: true,
          createContacts
        }),
        setPicked.mutateAsync({ bandId, ids: removed.map((item) => item.id), picked: false })
      ])
      await utils.invalidate()
      toast.success(t('Auswahl gespeichert'), {
        description: [
          add.changed > 0 && t('{{count}} dazu', { count: add.changed }),
          remove.changed > 0 && t('{{count}} entfernt', { count: remove.changed }),
          add.contactsCreated > 0 &&
            t('{{value}} Kontakte angelegt', { value: add.contactsCreated })
        ]
          .filter(Boolean)
          .join(' · ')
      })
      onOpenChange(false)
    } catch (error) {
      toast.error(t('Nicht gespeichert'), {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('Auswahl bearbeiten')}</DialogTitle>
          <DialogDescription>
            {t(
              'Was angehakt ist, steht auf der Arbeitsliste. Abgewählte Einträge behalten Status und Notiz und bleiben im Atlas.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4 text-sm">
          <AtlasPicker entries={entries} selected={selected} onChange={setSelected} />
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-primary"
              checked={createContacts}
              onChange={(event) => setCreateContacts(event.target.checked)}
            />
            <span>
              {t('Kontakte für neu ausgewählte Einträge anlegen')}
              <span className="block text-xs text-muted-foreground">
                {t('Radios, Podcasts und Presse werden Medien-Firmen, Clubs und Festivals Orte.')}
              </span>
            </span>
          </label>
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-sm text-muted-foreground">
            {[
              t('{{selected}} von {{total}} ausgewählt', {
                selected: selected.size,
                total: entries.length
              }),
              added.length > 0 && t('{{count}} dazu', { count: added.length }),
              removed.length > 0 && t('{{count}} entfernt', { count: removed.length })
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('Abbrechen')}
            </Button>
            <Button
              disabled={setPicked.isPending || added.length + removed.length === 0}
              onClick={save}
            >
              {t('Speichern')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
