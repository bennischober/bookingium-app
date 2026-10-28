import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { reportError } from '@/lib/errorReporting'

/** Shown in place of a page, or the whole app, that failed to render */
export function ErrorFallback({
  onRetry,
  retryLabel
}: {
  onRetry: () => void
  retryLabel: string
}) {
  return (
    <div
      role="alert"
      className="flex h-full min-h-48 flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <p className="font-medium">Hier ist ein Fehler aufgetreten.</p>
      <p className="max-w-md text-sm text-muted-foreground">
        Er wurde im Fehlerprotokoll vermerkt (Einstellungen › Daten).
      </p>
      <Button variant="outline" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  )
}

/**
 * The last line for render errors outside a route (dialog hosts, toasts, the providers); a
 * route's own errors are caught by the router (`defaultErrorComponent` in router.tsx)
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, info.componentStack ?? undefined)
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <ErrorFallback onRetry={() => window.location.reload()} retryLabel="Neu laden" />
    }
    return this.props.children
  }
}
