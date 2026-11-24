import { useId } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  CONTRIBUTOR_ROLE_SUGGESTIONS,
  WORK_ROLE_LABELS,
  WorkRole
} from '../../../../main/api/schemas/release.schema'
import {
  emptyContributor,
  emptyWorkShare,
  moveItem,
  type ContributorDraft,
  type WorkShareDraft
} from './releaseDrafts'
import { t } from '../../../../main/i18n/translate'

function RowButtons({
  index,
  count,
  onMove,
  onRemove
}: {
  index: number
  count: number
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}) {
  return (
    <div className="flex shrink-0 items-center">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        disabled={index === 0}
        onClick={() => onMove(-1)}
        aria-label={t('Nach oben')}
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        disabled={index === count - 1}
        onClick={() => onMove(1)}
        aria-label={t('Nach unten')}
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-8 w-8 text-destructive"
        onClick={onRemove}
        aria-label={t('Entfernen')}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

/** Who took part, one row each: name, role (with the usual roles offered) and instrument */
export function ContributorEditor({
  value,
  onChange,
  addLabel
}: {
  value: ContributorDraft[]
  onChange: (value: ContributorDraft[]) => void
  addLabel: string
}) {
  const listId = useId()
  const update = (index: number, patch: Partial<ContributorDraft>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  return (
    <div className="space-y-2">
      <datalist id={listId}>
        {CONTRIBUTOR_ROLE_SUGGESTIONS.map((role) => (
          <option key={role} value={role} />
        ))}
      </datalist>
      {value.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            aria-label={t('Name')}
            placeholder={t('Name')}
            value={row.name}
            onChange={(e) => update(index, { name: e.target.value })}
          />
          <Input
            aria-label={t('Rolle')}
            placeholder={t('Rolle')}
            list={listId}
            value={row.role}
            onChange={(e) => update(index, { role: e.target.value })}
          />
          <Input
            aria-label={t('Instrument')}
            placeholder={t('Instrument')}
            className="max-w-36"
            value={row.instrument}
            onChange={(e) => update(index, { instrument: e.target.value })}
          />
          <RowButtons
            index={index}
            count={value.length}
            onMove={(direction) => onChange(moveItem(value, index, direction))}
            onRemove={() => onChange(value.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => onChange([...value, emptyContributor()])}
      >
        <Plus className="h-3.5 w-3.5" />
        {addLabel}
      </Button>
    </div>
  )
}

/** The shares in the work: name, part, percent, society, IPI, publisher, country */
export function WorkShareEditor({
  value,
  onChange
}: {
  value: WorkShareDraft[]
  onChange: (value: WorkShareDraft[]) => void
}) {
  const update = (index: number, patch: Partial<WorkShareDraft>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  return (
    <div className="space-y-3">
      {value.map((row, index) => (
        <div key={index} className="space-y-2 rounded-md border p-2">
          <div className="flex items-center gap-2">
            <Input
              aria-label={t('Name')}
              placeholder={t('Name')}
              value={row.name}
              onChange={(e) => update(index, { name: e.target.value })}
            />
            <Select
              value={row.role}
              onValueChange={(role) => update(index, { role: role as WorkRole })}
            >
              <SelectTrigger className="w-36 shrink-0" aria-label={t('Anteil an')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WorkRole.options.map((role) => (
                  <SelectItem key={role} value={role}>
                    {WORK_ROLE_LABELS[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label={t('Anteil in Prozent')}
              placeholder="%"
              inputMode="decimal"
              className="w-20 shrink-0"
              value={row.share}
              onChange={(e) => update(index, { share: e.target.value })}
            />
            <RowButtons
              index={index}
              count={value.length}
              onMove={(direction) => onChange(moveItem(value, index, direction))}
              onRemove={() => onChange(value.filter((_, i) => i !== index))}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Input
              aria-label={t('Verwertungsgesellschaft')}
              placeholder={t('Verwertungsgesellschaft')}
              value={row.society}
              onChange={(e) => update(index, { society: e.target.value })}
            />
            <Input
              aria-label="IPI"
              placeholder="IPI"
              value={row.ipi}
              onChange={(e) => update(index, { ipi: e.target.value })}
            />
            <Input
              aria-label={t('Verlag')}
              placeholder={t('Verlag')}
              value={row.publisher}
              onChange={(e) => update(index, { publisher: e.target.value })}
            />
            <Input
              aria-label={t('Land')}
              placeholder={t('Land')}
              value={row.country}
              onChange={(e) => update(index, { country: e.target.value })}
            />
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => onChange([...value, emptyWorkShare()])}
      >
        <Plus className="h-3.5 w-3.5" />
        {t('Urheber hinzufügen')}
      </Button>
    </div>
  )
}
