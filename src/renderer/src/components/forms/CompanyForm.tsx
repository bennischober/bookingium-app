import { SearchableSelect } from '@/components/ui/searchable-select'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { FormFooter } from './FormActions'
import { FieldShell, FormBody } from './FormFields'
import { useAppForm } from './appForm'
import { GenreField } from './GenreField'
import { AddressFormFields } from './AddressFormFields'
import { ContactFormFields } from './ContactFormFields'
import { addressDefaults, contactDefaults } from './formDefaults'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { useFileDrop } from '@/hooks/useFileDrop'
import { InfoLabel } from '@/components/InfoLabel'
import { isValidIban } from '../../../../main/payment/epcQr'

import type { z } from 'zod'
import {
  COMPANY_KIND_LABELS,
  CompanyKind,
  type CompanyDto,
  type CreateCompanyInput
} from '../../../../main/api/schemas/company.schema'
import { t } from '../../../../main/i18n/translate'

/** IBAN/BIC as stored: no spaces, upper case */
const compact = (value: string) => value.replace(/\s+/g, '').toUpperCase()

const KIND_OPTIONS = CompanyKind.options.map((kind) => ({
  value: kind,
  label: COMPANY_KIND_LABELS[kind]
}))

interface CompanyFormProps {
  company?: CompanyDto
  onSubmit: (data: z.infer<typeof CreateCompanyInput> & { id?: number }) => void
  onCancel: () => void
  /** true while the save is running, so the form cannot be sent twice */
  isSubmitting?: boolean
}

// Resolves a stored relative logo/signature path to a displayable URL
function LogoPreview({ path }: { path: string }) {
  const [src, setSrc] = useState<string>('')

  useEffect(() => {
    let revoked = false
    if (!path) return

    void window.api.getLogoPath(path).then((result) => {
      if (result.success && result.dataUrl && !revoked) {
        setSrc(result.dataUrl)
      }
    })

    return () => {
      revoked = true
    }
  }, [path])

  if (!src) return null

  return (
    <img
      src={src}
      alt={t('Firmenlogo')}
      className="h-16 max-w-32 object-contain rounded border bg-white"
    />
  )
}

export function CompanyForm({
  company,
  onSubmit,
  onCancel,
  isSubmitting = false
}: CompanyFormProps) {
  const persons = trpcReact.person.getListItems.useQuery()
  const banks = trpcReact.bank.getAll.useQuery()
  const [logoPreview, setLogoPreview] = useState<string>(company?.logoPath || '')
  const [signaturePreview, setSignaturePreview] = useState<string>(company?.signaturePath || '')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const signatureInputRef = useRef<HTMLInputElement>(null)

  // Logo and signature belong to the main company (the default for invoicing, chosen in the
  // settings) only. That company always exists already, so a picked image is uploaded at once.
  const isMainCompany = company?.isDefaultForInvoicing === true

  /** Copies the chosen or dropped image into the storage folder; returns its relative path */
  const uploadImage = async (sourcePath: string, fallbackName: string): Promise<string | null> => {
    if (!company) return null
    const fileName = sourcePath.split(/[\\/]/).pop() || fallbackName
    const upload = await window.api.uploadLogo(company.id, sourcePath, fileName)
    if (!upload.success || !upload.relativePath) {
      toast.error(t('Bild konnte nicht übernommen werden'), { description: upload.error })
      return null
    }
    return upload.relativePath
  }

  /** The file the hidden input picked: its local path, so no second dialog opens */
  const pickedPath = (e: React.ChangeEvent<HTMLInputElement>): string | null => {
    const file = e.target.files?.[0]
    e.target.value = ''
    return file ? window.api.getPathForFile(file) || null : null
  }

  const setLogo = async (sourcePath: string | null) => {
    const path = sourcePath ? await uploadImage(sourcePath, 'logo') : null
    if (path) {
      setLogoPreview(path)
    }
  }

  const setSignature = async (sourcePath: string | null) => {
    const path = sourcePath ? await uploadImage(sourcePath, 'signature') : null
    if (path) {
      setSignaturePreview(path)
    }
  }

  const form = useAppForm({
    defaultValues: {
      name: company?.name || '',
      kind: company?.kind ?? ('company' as CompanyKind),
      genres: company?.genres ?? '',
      notes: company?.notes || '',
      vatId: company?.vatId || '',
      taxNumber: company?.taxNumber || '',
      commercialRegisterNo: company?.commercialRegisterNo || '',
      registerCourt: company?.registerCourt || '',
      customerNumber: company?.customerNumber == null ? '' : String(company.customerNumber),
      logoPath: company?.logoPath || '',
      signaturePath: company?.signaturePath || '',
      bank: {
        accountHolder: company?.bank?.accountHolder ?? '',
        iban: company?.bank?.iban ?? '',
        bic: company?.bank?.bic ?? '',
        bankName: company?.bank?.bankName ?? ''
      },
      invoiceContactPersonId: company?.invoiceContactPersonId ?? null,
      address: addressDefaults(company?.address),
      contact: contactDefaults(company?.contact)
    },
    onSubmit: async ({ value }) => {
      // The form leaves out a few input fields (kskNumber, isDefaultForInvoicing); zod defaults them
      // The Kundennummer is typed as text; empty means none
      const customerNumber =
        value.customerNumber.trim() === '' ? null : Number(value.customerNumber.trim())
      const payload = company
        ? {
            ...value,
            customerNumber,
            id: company.id,
            logoPath: logoPreview,
            signaturePath: signaturePreview
          }
        : { ...value, customerNumber }
      onSubmit(payload as z.infer<typeof CreateCompanyInput> & { id?: number })
    }
  })

  return (
    <FormBody form={form} disabled={isSubmitting}>
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">{t('Firmeninformationen')}</h3>

        <form.AppField name="name">
          {(field) => <field.TextField label={t('Firmenname')} required />}
        </form.AppField>

        <form.AppField name="customerNumber">
          {(field) => (
            <field.TextField
              label={t('Kundennummer')}
              inputMode="numeric"
              hint={t(
                'Leer lassen: Die Firma erhält ihre Nummer mit der ersten gestellten Rechnung.'
              )}
            />
          )}
        </form.AppField>

        <form.AppField name="kind">
          {(field) => (
            <field.SelectField
              label={t('Art')}
              options={KIND_OPTIONS}
              hint={t('Radio/Medien stehen mit ihren Ansprechpartnern in den Verteilern.')}
            />
          )}
        </form.AppField>

        {/* Genres only matter for the Verteiler, so only media companies get them */}
        <form.Subscribe selector={(state) => state.values.kind}>
          {(kind) =>
            kind === 'media' && (
              <form.AppField name="genres">
                {(field) => (
                  <field.FieldRow
                    label={t('Genres')}
                    hint={t(
                      'Mit Komma trennen, bekannte Genres werden vorgeschlagen; wird für die Verteiler genutzt.'
                    )}
                  >
                    <GenreField
                      id={field.name}
                      value={field.state.value}
                      onChange={field.handleChange}
                      onBlur={field.handleBlur}
                    />
                  </field.FieldRow>
                )}
              </form.AppField>
            )
          }
        </form.Subscribe>

        <div className="grid grid-cols-2 gap-4">
          <form.AppField name="vatId">
            {(field) => <field.TextField label="USt-IdNr." placeholder={t('z. B. DE123456789')} />}
          </form.AppField>
          <form.AppField name="taxNumber">
            {(field) => <field.TextField label={t('Steuernummer')} />}
          </form.AppField>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <form.AppField name="commercialRegisterNo">
            {(field) => <field.TextField label={t('Registernummer (HR-Nr.)')} />}
          </form.AppField>
          <form.AppField name="registerCourt">
            {(field) => <field.TextField label={t('Registergericht (Amtsgericht)')} />}
          </form.AppField>
        </div>

        {isMainCompany ? (
          <>
            <div className="space-y-2">
              <Label>{t('Logo (optional)')}</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                className="hidden"
                onChange={(e) => void setLogo(pickedPath(e))}
              />
              <div className="flex items-center gap-3">
                <ImageDropBox
                  path={logoPreview}
                  empty={t('Kein Logo')}
                  onFile={(path) => void setLogo(path)}
                />
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {t('Bild auswählen…')}
                  </Button>
                  {logoPreview && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        if (company && logoPreview) {
                          await window.api.deleteLogo(logoPreview)
                        }
                        setLogoPreview('')
                        form.setFieldValue('logoPath', '')
                      }}
                    >
                      {t('Entfernen')}
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('Unterschrift für Verträge (optional)')}</Label>
              <input
                ref={signatureInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                className="hidden"
                onChange={(e) => void setSignature(pickedPath(e))}
              />
              <div className="flex items-center gap-3">
                <ImageDropBox
                  path={signaturePreview}
                  empty={t('Keine Unterschrift')}
                  onFile={(path) => void setSignature(path)}
                />
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => signatureInputRef.current?.click()}
                  >
                    {t('Bild auswählen…')}
                  </Button>
                  {signaturePreview && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        if (company && signaturePreview) {
                          await window.api.deleteLogo(signaturePreview)
                        }
                        setSignaturePreview('')
                        form.setFieldValue('signaturePath', '')
                      }}
                    >
                      {t('Entfernen')}
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('Erscheint über der Unterschriftszeile der Band im Auftrittsvertrag.')}
              </p>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t(
              'Logo und Unterschrift gibt es nur bei der Standardfirma für Rechnungen (Einstellungen).'
            )}
          </p>
        )}

        <form.Field name="invoiceContactPersonId">
          {(field) => (
            <FieldShell>
              <InfoLabel
                htmlFor="invoiceContactPersonId"
                text={t('Ansprechpartner für Rechnungen (optional)')}
                info={t(
                  'Steht in der E-Rechnung als Kontakt: Name, Telefon und E-Mail der Person (sonst die der Firma).'
                )}
              />
              <SearchableSelect
                id="invoiceContactPersonId"
                value={field.state.value}
                onChange={field.handleChange}
                options={(persons.data ?? []).map((person) => ({
                  value: person.id,
                  label: `${person.firstName} ${person.lastName}`.trim()
                }))}
                noneLabel={t('Keiner')}
                searchPlaceholder={t('Person suchen…')}
                disabled={isSubmitting}
              />
            </FieldShell>
          )}
        </form.Field>

        <form.AppField name="notes">
          {(field) => <field.TextareaField label={t('Anmerkungen')} rows={3} />}
        </form.AppField>
      </div>

      <Separator />

      {/* #247: the account right here instead of a pick from the Banken page */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">{t('Bankverbindung')}</h3>
        {/* An account already on the Banken page (e.g. synced from another computer): picked
            here, saving links that row instead of copying it (saveCompanyBank) */}
        {(banks.data?.length ?? 0) > 0 && (
          <div className="space-y-2">
            <Label htmlFor="company-bank-pick">{t('Aus Banken übernehmen')}</Label>
            <form.Subscribe selector={(state) => state.values.bank}>
              {(current) => (
                <SearchableSelect
                  id="company-bank-pick"
                  value={
                    (banks.data ?? []).find(
                      (b) =>
                        compact(b.iban) === compact(current.iban) &&
                        compact(b.bic) === compact(current.bic) &&
                        b.accountHolder.trim() === current.accountHolder.trim() &&
                        b.bankName.trim() === current.bankName.trim()
                    )?.id ?? null
                  }
                  onChange={(id) => {
                    const picked = (banks.data ?? []).find((b) => b.id === id)
                    form.setFieldValue('bank', {
                      accountHolder: picked?.accountHolder ?? '',
                      bankName: picked?.bankName ?? '',
                      iban: picked?.iban ?? '',
                      bic: picked?.bic ?? ''
                    })
                  }}
                  options={(banks.data ?? []).map((b) => ({
                    value: b.id,
                    label: b.bankName || b.accountHolder || b.iban,
                    hint: [b.bankName ? b.accountHolder : '', b.iban].filter(Boolean).join(' · ')
                  }))}
                  noneLabel={t('Keine')}
                  placeholder={t('Bank wählen…')}
                  searchPlaceholder={t('Bank suchen…')}
                />
              )}
            </form.Subscribe>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <form.AppField name="bank.accountHolder">
            {(field) => <field.TextField label={t('Kontoinhaber')} />}
          </form.AppField>
          <form.AppField name="bank.bankName">
            {(field) => <field.TextField label={t('Bank')} />}
          </form.AppField>
        </div>
        <div className="grid grid-cols-[2fr_1fr] gap-4">
          <form.AppField
            name="bank.iban"
            validators={{
              onBlur: ({ value }) =>
                value.trim() && !isValidIban(value)
                  ? t('Die IBAN ist ungültig (Prüfziffer stimmt nicht)')
                  : undefined
            }}
          >
            {(field) => (
              <field.TextField label="IBAN" placeholder={t('DE.. .... .... .... .... ..')} />
            )}
          </form.AppField>
          <form.AppField name="bank.bic">
            {(field) => <field.TextField label="BIC" />}
          </form.AppField>
        </div>
      </div>

      <Separator />

      <AddressFormFields form={form} />

      <Separator />

      <ContactFormFields form={form} showNoAdvertising />

      <FormFooter onCancel={onCancel} submitting={isSubmitting}>
        {company ? t('Speichern') : t('Anlegen')}
      </FormFooter>
    </FormBody>
  )
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'svg'] as const

/** The logo or signature preview; an image dropped onto it replaces it */
function ImageDropBox({
  path,
  empty,
  onFile
}: {
  path: string
  empty: string
  onFile: (sourcePath: string) => void
}) {
  const { dragging, dropProps } = useFileDrop({
    extensions: IMAGE_EXTENSIONS,
    single: true,
    onFiles: ([file]) => onFile(file)
  })
  return (
    <div
      className={`rounded ${dragging ? 'ring-2 ring-primary ring-offset-2' : ''}`}
      title={t('Bild hierher ziehen')}
      {...dropProps}
    >
      {path ? (
        <LogoPreview path={path} />
      ) : (
        <div className="flex h-16 w-32 items-center justify-center rounded border border-dashed px-1 text-center text-xs text-muted-foreground">
          {dragging ? t('Hier ablegen') : t('{{empty}} · Bild hierher ziehen', { empty })}
        </div>
      )}
    </div>
  )
}
