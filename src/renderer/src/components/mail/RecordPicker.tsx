import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { RECORD_LABELS, RECORD_TYPES, type RecordChoice, type RecordType } from './recordChoices'

/**
 * The type select, the name search and the matches. The record is picked by NAME, not
 * by number - nobody knows the id of a band. The state stays with the dialog.
 */
export function RecordPicker({
  idPrefix,
  typeLabel,
  type,
  onTypeChange,
  search,
  onSearchChange,
  choices,
  selected,
  onChoose
}: {
  /** keeps the field ids apart when two dialogs use the picker */
  idPrefix: string
  typeLabel: string
  type: RecordType
  onTypeChange: (type: RecordType) => void
  search: string
  onSearchChange: (search: string) => void
  choices: RecordChoice[]
  selected: RecordChoice | null
  onChoose: (choice: RecordChoice) => void
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-type`}>{typeLabel}</Label>
        <Select value={type} onValueChange={(value) => onTypeChange(value as RecordType)}>
          <SelectTrigger id={`${idPrefix}-type`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RECORD_TYPES.map((option) => (
              <SelectItem key={option} value={option}>
                {RECORD_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-search`}>{RECORD_LABELS[type]} suchen</Label>
        <Input
          id={`${idPrefix}-search`}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Name eingeben…"
          autoComplete="off"
        />
        {/* The matches, so the record is picked by name instead of by number */}
        <ul aria-label="Treffer" className="max-h-48 overflow-auto rounded-md border empty:hidden">
          {choices.map((choice) => {
            const active = selected?.id === choice.id
            return (
              <li key={choice.id}>
                <button
                  type="button"
                  className={`w-full px-3 py-1.5 text-left text-sm hover:bg-muted ${
                    active ? 'bg-muted font-medium' : ''
                  }`}
                  aria-pressed={active}
                  onClick={() => onChoose(choice)}
                >
                  {choice.label}
                </button>
              </li>
            )
          })}
        </ul>
        {selected && <p className="text-xs text-muted-foreground">Ausgewählt: {selected.label}</p>}
      </div>
    </>
  )
}
