import { SearchableSelect } from '@/components/ui/searchable-select'
import { useForm } from '@tanstack/react-form'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FormActions } from '@/components/forms/FormActions'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { AddressFormFields } from './AddressFormFields'
import { ContactFormFields } from './ContactFormFields'
import { trpcReact } from '@/lib/trpc'
import { InfoLabel } from '@/components/InfoLabel'

import type { z } from 'zod'
import {
  COMPANY_KIND_LABELS,
  CompanyKind,
  type CompanyDto,
  type CreateCompanyInput
} from '../../../../main/api/schemas/company.schema'

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
  const form = useForm({
    defaultValues: {
      name: company?.name || '',
      kind: company?.kind ?? ('company' as CompanyKind),
      genres: company?.genres ?? '',
      notes: company?.notes || '',
      vatNumber: company?.vatNumber || '',
      ustNumber: company?.ustNumber || '',
      taxNumber: company?.taxNumber || '',
      commercialRegisterNo: company?.commercialRegisterNo || '',
      registerCourt: company?.registerCourt || '',
      logoPath: company?.logoPath || '',
      signaturePath: company?.signaturePath || '',
      bankId: company?.bank?.id || null,
      invoiceContactPersonId: company?.invoiceContactPersonId ?? null,
      address: {
        street: company?.address?.street || '',
        streetNumber: company?.address?.streetNumber || '',
        addressSuffix: company?.address?.addressSuffix || '',
        zipCode: company?.address?.zipCode || '',
        city: company?.address?.city || '',
        state: company?.address?.state || '',
        country: company?.address?.country || '',
        countryCode: company?.address?.countryCode || ''
      },
      contact: {
        email: company?.contact?.email || '',
        otherEmails: company?.contact?.otherEmails ?? [],
        phone: company?.contact?.phone || '',
        mobilePhone: company?.contact?.mobilePhone || '',
        homepage: company?.contact?.homepage || '',
        noAdvertising: company?.contact?.noAdvertising ?? false
      }
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
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
      className="space-y-6"
    >
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Firmeninformationen</h3>

        <form.Field name="name">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="name">Firmenname *</Label>
              <Input
                id="name"
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

        <form.Field name="kind">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="kind">Art</Label>
              <Select
                value={field.state.value}
                onValueChange={(value) => field.handleChange(value as CompanyKind)}
              >
                <SelectTrigger id="kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CompanyKind.options.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {COMPANY_KIND_LABELS[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Radio/Medien stehen mit ihren Ansprechpartnern in den Verteilern.
              </p>
            </div>
          )}
        </form.Field>

        {/* Genres only matter for the Verteiler, so only media companies get them */}
        <form.Subscribe selector={(state) => state.values.kind}>
          {(kind) =>
            kind === 'media' && (
              <form.Field name="genres">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="genres">Genres</Label>
                    <Input
                      id="genres"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="z. B. Metal, Rock"
                    />
                    <p className="text-xs text-muted-foreground">
                      Mit Komma trennen; wird für die Verteiler genutzt.
                    </p>
                  </div>
                )}
              </form.Field>
            )
          }
        </form.Subscribe>

        <div className="grid grid-cols-2 gap-4">
          <form.Field name="vatNumber">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="vatNumber">USt-IdNr.</Label>
                <Input
                  id="vatNumber"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </div>
            )}
          </form.Field>

          <form.Field name="ustNumber">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="ustNumber">USt-Nr.</Label>
                <Input
                  id="ustNumber"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </div>
            )}
          </form.Field>

          <form.Field name="taxNumber">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="taxNumber">Steuernummer</Label>
                <Input
                  id="taxNumber"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </div>
            )}
          </form.Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <form.Field name="commercialRegisterNo">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="commercialRegisterNo">Registernummer (HR-Nr.)</Label>
                <Input
                  id="commercialRegisterNo"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </div>
            )}
          </form.Field>

          <form.Field name="registerCourt">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="registerCourt">Registergericht (Amtsgericht)</Label>
                <Input
                  id="registerCourt"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </div>
            )}
          </form.Field>
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
                Erscheint über der Unterschriftszeile des Künstlers im Auftrittsvertrag.
              </p>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Logo und Unterschrift gibt es nur bei der Standardfirma für Rechnungen (Einstellungen).
          </p>
        )}

        <form.Field name="bankId">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="bankId">Bank (optional)</Label>
              {banks.isLoading ? (
                <p className="text-sm text-muted-foreground">Banken werden geladen…</p>
              ) : banks.data && banks.data.length > 0 ? (
                <SearchableSelect
                  id="bankId"
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={banks.data.map((bank) => ({
                    value: bank.id,
                    label: bank.bankName,
                    hint: bank.accountHolder
                  }))}
                  noneLabel="Keine"
                  searchPlaceholder="Bank suchen…"
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Keine Banken vorhanden. Legen Sie zuerst eine Bank auf der Banken-Seite an.
                </p>
              )}
            </div>
          )}
        </form.Field>

        <form.Field name="invoiceContactPersonId">
          {(field) => (
            <div className="space-y-2">
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
              />
            </div>
          )}
        </form.Field>

        <form.Field name="notes">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="notes">Anmerkungen</Label>
              <Textarea
                id="notes"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                rows={3}
              />
            </div>
          )}
        </form.Field>
      </div>

      <Separator />

      <AddressFormFields form={form} />

      <Separator />

      <ContactFormFields form={form} showNoAdvertising />

      <FormActions>
        <Button type="button" variant="outline" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Speichert…' : 'Firma speichern'}
        </Button>
      </FormActions>
    </form>
  )
}
