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
import { InfoLabel } from '@/components/InfoLabel'

import type { z } from 'zod'
import {
  COMPANY_KIND_LABELS,
  CompanyKind,
  type CompanyDto,
  type CreateCompanyInput
} from '../../../../main/api/schemas/company.schema'

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
      alt="Firmenlogo"
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
  // Fetch banks for dropdown
  const banks = trpcReact.bank.getListItems.useQuery()
  const persons = trpcReact.person.getListItems.useQuery()
  const [logoPreview, setLogoPreview] = useState<string>(company?.logoPath || '')
  const [signaturePreview, setSignaturePreview] = useState<string>(company?.signaturePath || '')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const signatureInputRef = useRef<HTMLInputElement>(null)

  // Logo and signature belong to the main company (the default for invoicing, chosen in the
  // settings) only. That company always exists already, so a picked image is uploaded at once.
  const isMainCompany = company?.isDefaultForInvoicing === true

  const pickImage = async (fallbackName: string): Promise<string | null> => {
    if (!company) return null
    const result = await window.api.showOpenDialog()
    if (result.canceled || result.filePaths.length === 0) return null
    const sourcePath = result.filePaths[0]
    const fileName = sourcePath.split(/[\\/]/).pop() || fallbackName
    const upload = await window.api.uploadLogo(company.id, sourcePath, fileName)
    return upload.success && upload.relativePath ? upload.relativePath : null
  }

  const handleLogoSelect = async () => {
    const path = await pickImage('logo')
    if (path) setLogoPreview(path)
  }

  const handleSignatureSelect = async () => {
    const path = await pickImage('signature')
    if (path) setSignaturePreview(path)
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
      logoPath: company?.logoPath || '',
      signaturePath: company?.signaturePath || '',
      bankId: company?.bank?.id || null,
      invoiceContactPersonId: company?.invoiceContactPersonId ?? null,
      address: addressDefaults(company?.address),
      contact: contactDefaults(company?.contact)
    },
    onSubmit: async ({ value }) => {
      // The form leaves out a few input fields (kskNumber, isDefaultForInvoicing); zod defaults them
      const payload = company
        ? { ...value, id: company.id, logoPath: logoPreview, signaturePath: signaturePreview }
        : value
      onSubmit(payload as z.infer<typeof CreateCompanyInput> & { id?: number })
    }
  })

  return (
    <FormBody form={form} disabled={isSubmitting}>
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Firmeninformationen</h3>

        <form.AppField name="name">
          {(field) => <field.TextField label="Firmenname" required />}
        </form.AppField>

        <form.AppField name="kind">
          {(field) => (
            <field.SelectField
              label="Art"
              options={KIND_OPTIONS}
              hint="Radio/Medien stehen mit ihren Ansprechpartnern in den Verteilern."
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
                    label="Genres"
                    hint="Mit Komma trennen, bekannte Genres werden vorgeschlagen; wird für die Verteiler genutzt."
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
            {(field) => <field.TextField label="USt-IdNr." placeholder="z. B. DE123456789" />}
          </form.AppField>
          <form.AppField name="taxNumber">
            {(field) => <field.TextField label="Steuernummer" />}
          </form.AppField>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <form.AppField name="commercialRegisterNo">
            {(field) => <field.TextField label="Registernummer (HR-Nr.)" />}
          </form.AppField>
          <form.AppField name="registerCourt">
            {(field) => <field.TextField label="Registergericht (Amtsgericht)" />}
          </form.AppField>
        </div>

        {isMainCompany ? (
          <>
            <div className="space-y-2">
              <Label>Logo (optional)</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleLogoSelect()
                }}
              />
              <div className="flex items-center gap-3">
                {logoPreview ? (
                  <LogoPreview path={logoPreview} />
                ) : (
                  <div className="flex h-16 w-32 items-center justify-center rounded border border-dashed text-xs text-muted-foreground">
                    Kein Logo
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Bild auswählen…
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
                      Entfernen
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Unterschrift für Verträge (optional)</Label>
              <input
                ref={signatureInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                className="hidden"
                onChange={() => void handleSignatureSelect()}
              />
              <div className="flex items-center gap-3">
                {signaturePreview ? (
                  <LogoPreview path={signaturePreview} />
                ) : (
                  <div className="flex h-16 w-32 items-center justify-center rounded border border-dashed text-xs text-muted-foreground">
                    Keine Unterschrift
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => signatureInputRef.current?.click()}
                  >
                    Bild auswählen…
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
                      Entfernen
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Erscheint über der Unterschriftszeile der Band im Auftrittsvertrag.
              </p>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Logo und Unterschrift gibt es nur bei der Standardfirma für Rechnungen (Einstellungen).
          </p>
        )}

        <form.AppField name="bankId">
          {(field) => (
            <field.FieldRow label="Bank (optional)">
              {banks.isLoading ? (
                <p className="text-sm text-muted-foreground">Banken werden geladen…</p>
              ) : banks.data && banks.data.length > 0 ? (
                <SearchableSelect
                  id={field.name}
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={banks.data.map((bank) => ({
                    value: bank.id,
                    label: bank.bankName,
                    hint: bank.accountHolder
                  }))}
                  noneLabel="Keine"
                  searchPlaceholder="Bank suchen…"
                  disabled={isSubmitting}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Keine Banken vorhanden. Legen Sie zuerst eine Bank auf der Banken-Seite an.
                </p>
              )}
            </field.FieldRow>
          )}
        </form.AppField>

        <form.Field name="invoiceContactPersonId">
          {(field) => (
            <FieldShell>
              <InfoLabel
                htmlFor="invoiceContactPersonId"
                text="Ansprechpartner für Rechnungen (optional)"
                info="Steht in der E-Rechnung als Kontakt: Name, Telefon und E-Mail der Person (sonst die der Firma)."
              />
              <SearchableSelect
                id="invoiceContactPersonId"
                value={field.state.value}
                onChange={field.handleChange}
                options={(persons.data ?? []).map((person) => ({
                  value: person.id,
                  label: `${person.firstName} ${person.lastName}`.trim()
                }))}
                noneLabel="Keiner"
                searchPlaceholder="Person suchen…"
                disabled={isSubmitting}
              />
            </FieldShell>
          )}
        </form.Field>

        <form.AppField name="notes">
          {(field) => <field.TextareaField label="Anmerkungen" rows={3} />}
        </form.AppField>
      </div>

      <Separator />

      <AddressFormFields form={form} />

      <Separator />

      <ContactFormFields form={form} showNoAdvertising />

      <FormFooter onCancel={onCancel} submitting={isSubmitting}>
        {company ? 'Speichern' : 'Anlegen'}
      </FormFooter>
    </FormBody>
  )
}
