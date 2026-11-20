import { Upload } from 'lucide-react'

/**
 * The overlay a drop area shows while files are dragged over it (useFileDrop). The area needs
 * `relative`; the overlay ignores the pointer, so the drop still reaches the area.
 */
export function DropOverlay({
  show,
  title,
  hint,
  inset = 'inset-0'
}: {
  show: boolean
  title: string
  hint?: string
  /** Tailwind inset class, e.g. 'inset-4' on a page with padding */
  inset?: string
}) {
  if (!show) return null
  return (
    <div
      className={`pointer-events-none absolute ${inset} z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/85`}
    >
      <div className="px-4 text-center">
        <Upload className="mx-auto mb-2 h-8 w-8 text-primary" />
        <p className="font-medium">{title}</p>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
    </div>
  )
}
