import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { type Address, addressProblem, isValidEmail, parseAddress } from './composeDraft'
import { recipientKeyAction } from './composeSend'

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

/** G8: where a recipient suggestion came from, in the dropdown */
const SOURCE_LABELS: Record<'person' | 'company' | 'venue' | 'mail', string> = {
  person: 'Kontakt',
  company: 'Firma',
  venue: 'Club / Festival',
  mail: 'Aus E-Mails'
}

/** Recipients as chips; typed text becomes one on Enter, comma or leaving the field */
export function RecipientField({
  label,
  accountId,
  value,
  onChange,
  autoFocus
}: {
  label: string
  accountId: string
  value: Address[]
  onChange: (value: Address[]) => void
  autoFocus?: boolean
}) {
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const [focused, setFocused] = useState(false)
  const query = useDebounced(text.trim(), 150)
  // G8: the app's own records are searched too, not only addresses seen in mail. A person you have
  // on file but never mailed was invisible here, which is the case the lookup exists for. The merge
  // happens in main (the dependency-free mail core cannot read the app database) and arrives ranked.
  const contacts = trpcReact.mail.contacts.useQuery(
    { query, accountId },
    { enabled: query.length >= 2, keepPreviousData: true }
  )
  const taken = new Set(value.map((a) => a.email.toLowerCase()))
  const suggestions =
    focused && text.trim().length >= 2
      ? (contacts.data ?? []).filter((c) => !taken.has(c.email.toLowerCase())).slice(0, 8)
      : []

  const add = (addresses: Address[]) => {
    const fresh = addresses.filter((a) => a.email && !taken.has(a.email.toLowerCase()))
    if (fresh.length) onChange([...value, ...fresh])
    setText('')
    setActive(0)
  }
  const commit = () => {
    const parts = text.split(/[,;]/).filter((p) => p.trim())
    if (parts.length) add(parts.map(parseAddress))
  }

  return (
    <div className="relative flex items-start gap-2 border-b px-4 py-1.5 text-sm">
      <span className="w-12 shrink-0 pt-1 text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {value.map((a) => {
          const valid = isValidEmail(a.email)
          // G12: the reason, not just "invalid" - the guard knows which part is wrong
          const problem = valid ? null : addressProblem(a.email)
          return (
            <span
              key={a.email}
              className={cn(
                'flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5',
                valid ? 'bg-muted' : 'bg-destructive/10 text-destructive'
              )}
              title={valid ? a.email : (addressProblem(a.email) ?? 'Keine gültige Adresse')}
            >
              <span className="truncate">{a.name || a.email}</span>
              {problem ? (
                <span className="text-xs opacity-80" data-testid="address-problem">
                  {problem}
                </span>
              ) : null}
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => onChange(value.filter((x) => x !== a))}
                aria-label={`${a.email} entfernen`}
              >
                <X className="size-3" />
              </button>
            </span>
          )
        })}
        <input
          className="min-w-32 flex-1 bg-transparent py-0.5 outline-none"
          value={text}
          autoFocus={autoFocus}
          aria-label={label}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            commit()
          }}
          onChange={(e) => {
            setText(e.target.value)
            setActive(0)
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text')
            if (!/[,;\n]/.test(pasted)) return
            e.preventDefault()
            add(
              pasted
                .split(/[,;\n]/)
                .filter((p) => p.trim())
                .map(parseAddress)
            )
          }}
          onKeyDown={(e) => {
            // Ctrl+Enter is the editor's send shortcut and goes on to the form
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) return
            const action = recipientKeyAction(e.key, {
              text,
              hasSuggestions: suggestions.length > 0,
              hasRecipients: value.length > 0
            })
            if (action === 'navigate') {
              e.preventDefault()
              const step = e.key === 'ArrowDown' ? 1 : -1
              setActive((i) => (i + step + suggestions.length) % suggestions.length)
            } else if (action === 'pick') {
              e.preventDefault()
              add([suggestions[Math.min(active, suggestions.length - 1)]])
            } else if (action === 'commit') {
              e.preventDefault()
              commit()
            } else if (action === 'swallow') {
              // I2 (MR-04): an Enter in an empty field used to fall through to the form
              e.preventDefault()
            } else if (action === 'removeLast') {
              onChange(value.slice(0, -1))
            }
          }}
        />
      </div>
      {suggestions.length > 0 && (
        <ul
          className="absolute top-full right-4 left-16 z-10 mt-1 overflow-hidden rounded-md border bg-popover shadow-md"
          role="listbox"
          aria-label="Vorschläge"
        >
          {suggestions.map((c, i) => (
            <li
              key={c.email}
              role="option"
              aria-selected={i === active}
              className={cn('cursor-pointer px-3 py-1.5', i === active && 'bg-muted')}
              // Before the input's blur, which would take the typed text as it is
              onMouseDown={(e) => {
                e.preventDefault()
                add([c])
              }}
              onMouseEnter={() => setActive(i)}
            >
              {c.name ? (
                <>
                  {c.name} <span className="text-muted-foreground">{c.email}</span>
                </>
              ) : (
                c.email
              )}
              {/* G8: why this address is here. A mail-history hit and an address-book record look
                  identical otherwise, and the user should know which one they are picking. */}
              <span className="ml-2 text-xs text-muted-foreground/70">
                {SOURCE_LABELS[c.source]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
