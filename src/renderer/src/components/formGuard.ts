import { createContext, useContext, useEffect, useId } from 'react'

/**
 * Whether a form inside a `FormSheet` holds changes that are not saved. A form reports
 * through `useReportUnsavedChanges`; `FormBody` does it for every TanStack form. The sheet
 * asks before Esc, a click outside or its close button would throw those changes away.
 * Saving and the form's own "Abbrechen" close without asking.
 */
export type ReportUnsavedChanges = (formId: string, unsaved: boolean) => void

export const UnsavedChangesContext = createContext<ReportUnsavedChanges | null>(null)

export function useReportUnsavedChanges(unsaved: boolean): void {
  const report = useContext(UnsavedChangesContext)
  const formId = useId()
  useEffect(() => {
    report?.(formId, unsaved)
  }, [report, formId, unsaved])
  // an unmounted form has nothing left to lose
  useEffect(() => () => report?.(formId, false), [report, formId])
}
