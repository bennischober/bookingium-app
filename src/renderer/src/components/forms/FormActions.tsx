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
