import { FormFooter } from './FormActions'
import { FormBody } from './FormFields'
import { useAppForm } from './appForm'
import type { z } from 'zod'
import type { BankDto, CreateBankInput } from '../../../../main/api/schemas/bank.schema'

interface BankFormProps {
  bank?: BankDto
  onSubmit: (data: z.infer<typeof CreateBankInput> & { id?: number }) => void
  onCancel: () => void
}

export function BankForm({ bank, onSubmit, onCancel }: BankFormProps) {
  const form = useAppForm({
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
    <FormBody form={form} className="space-y-4">
      <form.AppField name="bankName">
        {(field) => <field.TextField label="Bankname" required />}
      </form.AppField>
      <form.AppField name="accountHolder">
        {(field) => <field.TextField label="Kontoinhaber" required />}
      </form.AppField>
      <form.AppField name="iban">
        {(field) => <field.TextField label="IBAN" required placeholder="DE89370400440532013000" />}
      </form.AppField>
      <form.AppField name="bic">
        {(field) => <field.TextField label="BIC/SWIFT" required placeholder="COBADEFFXXX" />}
      </form.AppField>

      <FormFooter onCancel={onCancel}>Bank speichern</FormFooter>
    </FormBody>
  )
}
