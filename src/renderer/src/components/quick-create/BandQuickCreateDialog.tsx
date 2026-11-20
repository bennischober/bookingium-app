import { useState } from 'react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EntityCombobox } from '@/components/ui/entity-combobox'
import { GenreField } from '@/components/forms/GenreField'
import { QuickCreateDialog } from '@/components/quick-create/QuickCreateDialog'
import { CompanyQuickCreateDialog } from '@/components/quick-create/CompanyQuickCreateDialog'
import { t } from '../../../../main/i18n/translate'

/** A band with name, genre and management company */
export function BandQuickCreateDialog({
  isOpen,
  prefillName,
  onClose,
  onCreated
}: {
  isOpen: boolean
  prefillName: string
  onClose: () => void
  onCreated: (id: number, name: string) => void
}) {
  const [name, setName] = useState(prefillName)
  const [genre, setGenre] = useState('')
  const [companyId, setCompanyId] = useState<number | null>(null)
  const [newCompanyName, setNewCompanyName] = useState<string | null>(null)

  const companies = trpcReact.company.getListItems.useQuery()

  const createBand = trpcReact.band.create.useMutation({
    onSuccess: (band) => {
      toast.success(t('Band "{{name}}" erstellt', { name: band.name }))
      onCreated(band.id, band.name)
      onClose()
    },
    onError: (e) => toast.error(t('Band konnte nicht erstellt werden'), { description: e.message })
  })

  const handleSubmit = () => {
    if (!name.trim() || companyId === null) return
    createBand.mutate({ name: name.trim(), genre: genre.trim(), companyId })
  }

  // Keep name in sync when dialog opens with a new prefill
  if (isOpen && name !== prefillName && prefillName) {
    setName(prefillName)
  }

  return (
    <>
      <QuickCreateDialog
        isOpen={isOpen}
        title={t('Neue Band anlegen')}
        submitLabel={t('Anlegen')}
        submitDisabled={!name.trim() || companyId === null || createBand.isPending}
        onSubmit={handleSubmit}
        onClose={onClose}
      >
        <div className="space-y-2">
          <Label htmlFor="band-name">{t('Bandname *')}</Label>
          <Input
            id="band-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('z. B. Die Toten Hosen')}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="band-genre">{t('Genre')}</Label>
          <GenreField
            id="band-genre"
            value={genre}
            onChange={setGenre}
            placeholder={t('z. B. Rock')}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('Firma *')}</Label>
          <EntityCombobox
            items={(companies.data ?? []).map((c) => ({ id: c.id, label: c.name }))}
            value={companyId}
            onChange={setCompanyId}
            placeholder={t('Firma auswählen…')}
            searchPlaceholder={t('Firma suchen…')}
            emptyText={t('Keine Firma gefunden.')}
            onCreateNew={setNewCompanyName}
            createNewLabel={t('Neue Firma anlegen')}
            isLoading={companies.isLoading}
          />
        </div>
      </QuickCreateDialog>

      <CompanyQuickCreateDialog
        isOpen={newCompanyName !== null}
        prefillName={newCompanyName ?? ''}
        onClose={() => setNewCompanyName(null)}
        onCreated={(id) => setCompanyId(id)}
      />
    </>
  )
}
