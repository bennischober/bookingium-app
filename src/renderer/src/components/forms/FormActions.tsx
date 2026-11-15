import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * #161: the action row of a form in a side panel (FormSheet). It stays at the
 * bottom of the panel while a long form scrolls, so saving needs no scrolling.
 * The negative margin spans the panel's padding, so the border runs edge to edge.
 */
export function FormActions({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 -mx-6 mt-2 flex justify-end gap-2 border-t bg-background px-6 py-4',
        className
      )}
      {...props}
    />
  )
}

/**
 * #171: the usual action row, "Abbrechen" and the submit button. While saving both are
 * disabled and the submit button says "Speichert…".
 */
export function FormFooter({
  onCancel,
  submitting = false,
  children
}: {
  onCancel: () => void
  submitting?: boolean
  /** The submit button's label */
  children: ReactNode
}) {
  return (
    <FormActions>
      <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
        Abbrechen
      </Button>
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Speichert…' : children}
      </Button>
    </FormActions>
  )
}
