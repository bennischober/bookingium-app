import { Info } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

// Label with an (i) info icon that shows explanatory text in a tooltip.
// Used to keep forms compact: short label on the line, details on hover.
// Ships its own TooltipProvider so it works anywhere in the tree.
export function InfoLabel({
  text,
  info,
  htmlFor,
  className
}: {
  text: string
  info: string
  htmlFor?: string
  className?: string
}) {
  return (
    <div className={`flex items-center gap-1.5 ${className ?? ''}`}>
      <Label htmlFor={htmlFor}>{text}</Label>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Info: ${text}`}
              className="text-muted-foreground transition-colors hover:text-foreground"
              onClick={(e) => e.preventDefault()}
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[280px]">
            <span>{info}</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}
