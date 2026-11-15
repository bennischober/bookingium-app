import { useState } from 'react'
import { toast } from '@/lib/toast'
import {
  EMPTY_LINE,
  removeLine,
  saveLine,
  type InvoiceLineDraft
} from '@/components/invoice/invoiceFormState'

export type InvoiceLineEditor = ReturnType<typeof useInvoiceLineEditor>

/**
 * The invoice form's one line editor: adds a line, or changes the one picked
 * with `openEdit`. Held by the form, not the lines step, so a half-typed line
 * survives switching steps (inactive tabs unmount).
 */
export function useInvoiceLineEditor(
  lines: InvoiceLineDraft[],
  onChange: (lines: InvoiceLineDraft[]) => void
) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [line, setLine] = useState<InvoiceLineDraft>({ ...EMPTY_LINE })

  const reset = () => {
    setEditingIndex(null)
    setLine({ ...EMPTY_LINE })
  }

  return {
    editingIndex,
    line,
    setField: (patch: Partial<InvoiceLineDraft>) => setLine((prev) => ({ ...prev, ...patch })),
    reset,
    openEdit: (index: number) => {
      setEditingIndex(index)
      setLine({ ...lines[index] })
    },
    save: () => {
      if (!line.description.trim()) {
        toast.error('Bitte eine Positionsbeschreibung eingeben')
        return
      }
      onChange(saveLine(lines, editingIndex, line))
      reset()
    },
    remove: (index: number) => {
      onChange(removeLine(lines, index))
      if (editingIndex === index) reset()
    }
  }
}
