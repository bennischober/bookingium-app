import { UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { EntityCombobox, type ComboboxItem } from '@/components/ui/entity-combobox'
import type { SetWizardField, WizardFormData } from '@/components/event-wizard/wizardState'

/** Step 2 (optional): the local promoter, a person and/or a company */
export function EventLoProStep({
  form,
  set,
  personItems,
  personsLoading,
  onCreatePerson,
  onCreateSenderPerson,
  companyItems,
  companiesLoading
}: {
  form: WizardFormData
  set: SetWizardField
  personItems: ComboboxItem[]
  personsLoading: boolean
  onCreatePerson: (query: string) => void
  /** #122: offered while no person is picked, for a mail sender nobody stored */
  onCreateSenderPerson?: () => void
  companyItems: ComboboxItem[]
  companiesLoading: boolean
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Der LoPro (Local Promoter) ist die Person und/oder Firma, die vor Ort für die Show
        verantwortlich ist.
      </p>

      <div className="space-y-2">
        <Label>LoPro-Kontaktperson</Label>
        <EntityCombobox
          items={personItems}
          value={form.loProPersonId}
          onChange={(id) => set('loProPersonId', id)}
          placeholder="Person auswählen…"
          searchPlaceholder="Personen suchen…"
          isLoading={personsLoading}
          onCreateNew={onCreatePerson}
          createNewLabel="Neue Person anlegen"
        />
        {onCreateSenderPerson && form.loProPersonId === null && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={onCreateSenderPerson}
          >
            <UserPlus className="h-3.5 w-3.5" />
            Absender als Person anlegen
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <Label>LoPro-Firma</Label>
        <EntityCombobox
          items={companyItems}
          value={form.loProCompanyId}
          onChange={(id) => set('loProCompanyId', id)}
          placeholder="Firma auswählen…"
          searchPlaceholder="Firmen suchen…"
          isLoading={companiesLoading}
        />
      </div>
    </div>
  )
}
