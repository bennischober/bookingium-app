import { useEffect, useState } from 'react'
import { Keyboard } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { ROUTE_SHORTCUTS } from '@/lib/routing'

// Global keyboard shortcuts, listed in one place so the help dialog and the
// bindings can't drift apart. The Alt+digit jumps follow the menu order
// (ROUTE_SHORTCUTS); Ctrl+K (search) is registered in search-command-button.
const SHORTCUTS: Array<{ keys: string[]; description: string }> = [
  { keys: ['Ctrl', 'K'], description: 'Alles suchen öffnen' },
  ...ROUTE_SHORTCUTS.map(({ key, route }) => ({ keys: ['Alt', key], description: route.title })),
  { keys: ['?'], description: 'Diese Hilfe anzeigen' },
  { keys: ['Esc'], description: 'Dialoge schließen' }
]

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // '?' via Shift+/ — ignore when typing in inputs
      if (event.key === '?' && !isTypingTarget(event.target)) {
        event.preventDefault()
        setOpen((prev) => !prev)
        return
      }

      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        const shortcut = ROUTE_SHORTCUTS.find(({ key }) => event.key === key)
        if (shortcut) {
          event.preventDefault()
          window.location.hash = '#' + shortcut.route.path
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        title="Tastaturkürzel (?)"
        aria-label="Tastaturkürzel anzeigen"
      >
        <Keyboard className="h-4 w-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Tastaturkürzel</DialogTitle>
            <DialogDescription>Schneller durch die App mit der Tastatur.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {SHORTCUTS.map((shortcut) => (
              <div key={shortcut.description} className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{shortcut.description}</span>
                <span className="flex gap-1">
                  {shortcut.keys.map((key) => (
                    <kbd
                      key={key}
                      className="rounded border border-muted-foreground/30 bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium"
                    >
                      {key}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}
