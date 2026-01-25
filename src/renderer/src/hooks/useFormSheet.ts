import { useState } from 'react'

export type FormMode = 'create' | 'edit'

export interface FormSheetState<T> {
  isOpen: boolean
  mode: FormMode
  selectedItem: T | null
}

export function useFormSheet<T>() {
  const [state, setState] = useState<FormSheetState<T>>({
    isOpen: false,
    mode: 'create',
    selectedItem: null
  })

  const openCreate = () => {
    setState({
      isOpen: true,
      mode: 'create',
      selectedItem: null
    })
  }

  const openEdit = (item: T) => {
    setState({
      isOpen: true,
      mode: 'edit',
      selectedItem: item
    })
  }

  const close = () => {
    setState({
      isOpen: false,
      mode: 'create',
      selectedItem: null
    })
  }

  return {
    isOpen: state.isOpen,
    mode: state.mode,
    selectedItem: state.selectedItem,
    openCreate,
    openEdit,
    close
  }
}
