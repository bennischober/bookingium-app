import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import type { FormMode } from '@/hooks/useFormSheet'

interface FormSheetProps {
  isOpen: boolean
  onClose: () => void
  mode: FormMode
  title?: string
  description?: string
  children: React.ReactNode
}

export function FormSheet({
  isOpen,
  onClose,
  mode,
  title,
  description,
  children
}: FormSheetProps) {
  const defaultTitle = mode === 'create' ? 'Create New' : 'Edit'
  const defaultDescription =
    mode === 'create'
      ? 'Fill in the details to create a new record.'
      : 'Make changes to the record below.'

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title || defaultTitle}</SheetTitle>
          <SheetDescription>{description || defaultDescription}</SheetDescription>
        </SheetHeader>
        <div className="mt-6">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
