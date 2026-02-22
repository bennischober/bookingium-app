import { Clock } from 'lucide-react'

interface PlaceholderTabProps {
  title: string
  description: string
}

export function PlaceholderTab({ title, description }: PlaceholderTabProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Clock className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="font-semibold text-lg mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-xs">{description}</p>
    </div>
  )
}
