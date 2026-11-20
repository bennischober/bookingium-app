import * as React from 'react'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { t } from '../../../../main/i18n/translate'

export interface ComboboxItem {
  id: number
  label: string
}

interface EntityComboboxProps {
  /** Items to display in the list */
  items: ComboboxItem[]
  /** Currently selected id */
  value: number | null | undefined
  onChange: (id: number | null) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  isLoading?: boolean
  /** Fired when user clicks "Neu anlegen" — receives the current search query */
  onCreateNew?: (query: string) => void
  createNewLabel?: string
  disabled?: boolean
  className?: string
}

export function EntityCombobox({
  items,
  value,
  onChange,
  placeholder = t('Auswählen…'),
  searchPlaceholder = t('Suchen…'),
  emptyText = t('Keine Treffer.'),
  isLoading = false,
  onCreateNew,
  createNewLabel = t('Neu anlegen'),
  disabled = false,
  className
}: EntityComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')

  const selectedItem = items.find((item) => item.id === value)

  const handleSelect = (id: number) => {
    onChange(value === id ? null : id)
    setOpen(false)
    setQuery('')
  }

  const handleCreateNew = () => {
    setOpen(false)
    onCreateNew?.(query)
    setQuery('')
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        role="combobox"
        disabled={disabled || isLoading}
        onClick={() => setOpen(true)}
        className={cn('w-full justify-between font-normal', className)}
      >
        <span className={cn(!selectedItem && 'text-muted-foreground')}>
          {isLoading ? t('Wird geladen…') : selectedItem ? selectedItem.label : placeholder}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder={searchPlaceholder} value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>
            <span className="text-sm text-muted-foreground">{emptyText}</span>
          </CommandEmpty>

          <CommandGroup>
            {items.map((item) => (
              <CommandItem key={item.id} value={item.label} onSelect={() => handleSelect(item.id)}>
                <Check
                  className={cn('mr-2 h-4 w-4', value === item.id ? 'opacity-100' : 'opacity-0')}
                />
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>

          {onCreateNew && (
            <>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem onSelect={handleCreateNew} className="text-primary">
                  <Plus className="mr-2 h-4 w-4" />
                  {query ? `${createNewLabel} "${query}"` : createNewLabel}
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>
    </>
  )
}
