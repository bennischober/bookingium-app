// Loading, empty and error states shared by tabs, cards, sheets and tables.
// The whole-page "X wird geladen…" stays centred text in the page itself.
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { QueryError } from '@/lib/queryErrors'

/** One muted line while something loads */
export function LoadingRow({
  children = 'Wird geladen…',
  className
}: {
  children?: React.ReactNode
  className?: string
}) {
  return (
    <p role="status" className={cn('text-sm text-muted-foreground', className)}>
      {children}
    </p>
  )
}

/** There is nothing to show (yet) */
export function EmptyState({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn('text-sm text-muted-foreground', className)}>{children}</div>
}

/** Loading failed: says so, with the error's message and a retry */
export function ErrorState({
  error,
  onRetry,
  className
}: {
  error: QueryError
  onRetry: () => void
  className?: string
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-start gap-2 text-sm', className)}>
      <p className="font-medium">Konnte nicht geladen werden</p>
      {error?.message && <p className="break-words text-muted-foreground">{error.message}</p>}
      <Button variant="outline" size="sm" onClick={onRetry}>
        Erneut versuchen
      </Button>
    </div>
  )
}

/** The whole page's record could not be loaded (a missing record is not this: see isNotFound) */
export function PageErrorState({ error, onRetry }: { error: QueryError; onRetry: () => void }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <ErrorState error={error} onRetry={onRetry} className="items-center text-center" />
    </div>
  )
}
