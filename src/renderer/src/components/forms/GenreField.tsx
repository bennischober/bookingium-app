import * as React from 'react'
import { Input } from '@/components/ui/input'
import { trpcReact } from '@/lib/trpc'
import { cn } from '@/lib/utils'

interface GenreFieldProps {
  id: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  disabled?: boolean
  placeholder?: string
}

const MAX_SUGGESTIONS = 8
const fold = (text: string) => text.toLocaleLowerCase('de')

/**
 * Genre tags as text ("Metal, Rock"), with suggestions from the genres already in use
 * (#152): the tag being typed is completed from them, and a new one is simply kept.
 * The same spelling then reaches every record, which is what the Verteiler filters by.
 */
export function GenreField({
  id,
  value,
  onChange,
  onBlur,
  disabled,
  placeholder = 'z. B. Metal, Rock'
}: GenreFieldProps) {
  const known = trpcReact.genre.list.useQuery()
  const [focused, setFocused] = React.useState(false)
  const [active, setActive] = React.useState(-1)
  const [dismissed, setDismissed] = React.useState(false)

  // The tag being typed is the text after the last separator
  const cut = Math.max(value.lastIndexOf(','), value.lastIndexOf(';')) + 1
  const prefix = value.slice(0, cut)
  const fragment = value.slice(cut).trim()
  const taken = new Set(
    prefix
      .split(/[,;]/)
      .map((tag) => fold(tag.trim()))
      .filter(Boolean)
  )
  const suggestions = fragment
    ? (known.data ?? [])
        .filter(
          (genre) =>
            fold(genre).includes(fold(fragment)) &&
            fold(genre) !== fold(fragment) &&
            !taken.has(fold(genre))
        )
        .slice(0, MAX_SUGGESTIONS)
    : []
  const open = focused && !dismissed && suggestions.length > 0
  const listId = `${id}-suggestions`

  const pick = (genre: string) => {
    onChange(`${prefix ? `${prefix.trimEnd()} ` : ''}${genre}, `)
    setActive(-1)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (index + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (index <= 0 ? suggestions.length - 1 : index - 1))
    } else if (event.key === 'Enter' && active >= 0) {
      // Takes the suggestion instead of submitting the form
      event.preventDefault()
      pick(suggestions[active])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setDismissed(true)
    }
  }

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          setActive(-1)
          setDismissed(false)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          setActive(-1)
          onBlur?.()
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Bekannte Genres"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
        >
          {suggestions.map((genre, index) => (
            <li
              key={genre}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              // mousedown, not click: the input keeps the focus
              onMouseDown={(event) => {
                event.preventDefault()
                pick(genre)
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                'cursor-default rounded-sm px-2 py-1.5',
                index === active && 'bg-accent text-accent-foreground'
              )}
            >
              {genre}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
