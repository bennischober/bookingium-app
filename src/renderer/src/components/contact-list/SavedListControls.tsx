import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { SavedContactListDto } from '../../../../main/api/schemas/contactList.schema'
import { t } from '../../../../main/i18n/translate'

/**
 * The page header's controls: the filter toggle, the saved list picker and
 * save, save as, rename and delete. A member list (#154) has no filters, so
 * the filter toggle, save and save as are left out for it.
 */
export function SavedListControls({
  savedLists,
  savedId,
  saved,
  onChoose,
  filtersOpen,
  onToggleFilters,
  activeFilters,
  changed,
  saving,
  onSave,
  onSaveAs,
  onRename,
  onDelete
}: {
  savedLists: SavedContactListDto[] | undefined
  /** The chosen saved list's id; it may not be in `savedLists` yet right after saving */
  savedId: number | null
  /** The open saved list, or null for a new one */
  saved: SavedContactListDto | null
  /** A saved list's id as a string, or 'new' */
  onChoose: (value: string) => void
  filtersOpen: boolean
  onToggleFilters: () => void
  activeFilters: number
  changed: boolean
  saving: boolean
  onSave: () => void
  onSaveAs: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const memberList = saved?.kind === 'members'

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!memberList && (
        <Button
          variant={filtersOpen ? 'secondary' : 'outline'}
          aria-pressed={filtersOpen}
          onClick={onToggleFilters}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {t('Filter')}
          {activeFilters > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-xs leading-5 text-primary-foreground">
              {activeFilters}
            </span>
          )}
        </Button>
      )}
      <Select value={savedId === null ? 'new' : String(savedId)} onValueChange={onChoose}>
        <SelectTrigger className="w-56" aria-label={t('Gespeicherter Verteiler')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="new">{t('Neuer Verteiler')}</SelectItem>
          {savedLists?.map((entry) => (
            <SelectItem key={entry.id} value={String(entry.id)}>
              {entry.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!memberList && (
        <Button variant="outline" onClick={onSave} disabled={!changed || saving}>
          {t('Speichern')}
        </Button>
      )}
      {saved && (
        <>
          {!memberList && (
            <Button variant="outline" onClick={onSaveAs}>
              {t('Speichern unter…')}
            </Button>
          )}
          <Button variant="outline" onClick={onRename}>
            {t('Umbenennen')}
          </Button>
          <Button variant="outline" onClick={onDelete}>
            {t('Löschen')}
          </Button>
        </>
      )}
    </div>
  )
}
