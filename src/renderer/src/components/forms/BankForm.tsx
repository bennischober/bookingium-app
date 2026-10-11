import { useForm } from '@tanstack/react-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { BankDto } from '../../../../main/api/schemas/bank.schema'

interface BankFormProps {
  bank?: BankDto
  onSubmit: (data: any) => void
  onCancel: () => void
}

export function BankForm({ bank, onSubmit, onCancel }: BankFormProps) {
  const form = useForm({
    defaultValues: {
      bankName: bank?.bankName || '',
      accountHolder: bank?.accountHolder || '',
      iban: bank?.iban || '',
      bic: bank?.bic || ''
    },
    onSubmit: async ({ value }) => {
      onSubmit(bank ? { ...value, id: bank.id } : value)
    }
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
      className="space-y-4"
    >
      <form.Field name="bankName">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor="bankName">Bankname *</Label>
            <Input
              id="bankName"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-red-500">{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="accountHolder">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor="accountHolder">Kontoinhaber *</Label>
            <Input
              id="accountHolder"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-red-500">{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="iban">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor="iban">IBAN *</Label>
            <Input
              id="iban"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="DE89370400440532013000"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-red-500">{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="bic">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor="bic">BIC/SWIFT *</Label>
            <Input
              id="bic"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="COBADEFFXXX"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-red-500">{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button type="submit">Bank speichern</Button>
      </div>
    </form>
  )
}
