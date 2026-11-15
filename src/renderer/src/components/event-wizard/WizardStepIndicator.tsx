import { cn } from '@/lib/utils'
import { WIZARD_STEPS } from '@/components/event-wizard/wizardState'

/** The numbered steps above the wizard; done steps show a tick */
export function WizardStepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {WIZARD_STEPS.map((step, i) => {
        const num = i + 1
        const active = num === current
        const done = num < current
        return (
          <div key={num} className="flex items-center gap-2">
            {i > 0 && <div className="h-px w-6 bg-border" />}
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                  done && 'bg-primary text-primary-foreground',
                  active && 'border-2 border-primary text-primary',
                  !done && !active && 'border border-border text-muted-foreground'
                )}
              >
                {done ? '✓' : num}
              </div>
              <span
                className={cn(
                  'text-xs',
                  active ? 'font-medium' : 'text-muted-foreground',
                  !step.required && !active && 'opacity-60'
                )}
              >
                {step.label}
                {!step.required && (
                  <span className="ml-0.5 text-muted-foreground"> (optional)</span>
                )}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
