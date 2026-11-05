import { useTheme } from 'next-themes'
import { Toaster as Sonner } from 'sonner'

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      // Never in print output (printToPDF captures the whole window, and a
      // toast's "Drucken" action opens a print page while it is still shown)
      className="toaster group print:hidden!"
      // Clickable over modal sheets and dialogs too (they turn off pointer
      // events on the page behind them; see keepOpenOnToast)
      style={{ pointerEvents: 'auto' }}
      // Every toast can be closed; how long one stays is set in lib/toast.ts
      closeButton
      toastOptions={{
        closeButtonAriaLabel: 'Schließen',
        classNames: {
          // The × sits top right (sonner's default is top left)
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg [--toast-close-button-start:auto] [--toast-close-button-end:0] [--toast-close-button-transform:translate(35%,-35%)]',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground'
        }
      }}
      {...props}
    />
  )
}

export { Toaster }
