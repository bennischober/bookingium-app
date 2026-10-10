import { useForm } from '@tanstack/react-form'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { AddressFormFields } from './AddressFormFields'
import { ContactFormFields } from './ContactFormFields'
import { trpcReact } from '@/main'
import { CompanyDto } from 'src/main/api/schemas/company.schema'

interface CompanyFormProps {
  company?: CompanyDto
  onSubmit: (data: any) => void
  onCancel: () => void
}

// Resolves a stored relative logo path (or freshly picked absolute path) to a displayable URL
function LogoPreview({ path }: { path: string }) {
  const [src, setSrc] = useState<string>('')

  useEffect(() => {
    let revoked = false
    if (!path) return

    if (/^[a-zA-Z]:[\\/]/.test(path)) {
      // Freshly picked absolute path from the dialog: the file is readable by
      // the main process only, so resolve a data URL through IPC.
      const fileName = path.split(/[\\/]/).pop() || 'logo'
      void window.api
        .uploadLogo(0, path, fileName)
        .then(async (result) => {
          if (result.success && result.relativePath) {
            const dataUrl = await window.api.getLogoPath(result.relativePath)
            if (dataUrl.success && dataUrl.dataUrl && !revoked) setSrc(dataUrl.dataUrl)
          }
        })
      return
    }

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

  return <img src={src} alt="Company logo" className="h-16 max-w-32 object-contain rounded border bg-white" />
}

export function CompanyForm({ company, onSubmit, onCancel }: CompanyFormProps) {
  // Fetch banks for dropdown
  const banks = trpcReact.bank.getListItems.useQuery()
  const [logoPreview, setLogoPreview] = useState<string>(company?.logoPath || '')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleLogoSelect = async () => {
    const result = await window.api.showOpenDialog()
    if (result.canceled || result.filePaths.length === 0) return

    const sourcePath = result.filePaths[0]
    const fileName = sourcePath.split(/[\\/]/).pop() || 'logo'
    // New company has no id yet -> logo is stored after creation (see onSubmit),
    // for existing companies we upload immediately and store the relative path.
    if (company) {
      const upload = await window.api.uploadLogo(company.id, sourcePath, fileName)
      if (upload.success && upload.relativePath) {
        setLogoPreview(upload.relativePath)
      }
    } else {
      setLogoPreview(sourcePath)
    }
  }
  const form = useForm({
    defaultValues: {
      name: company?.name || '',
      notes: company?.notes || '',
      vatNumber: company?.vatNumber || '',
      ustNumber: company?.ustNumber || '',
      taxNumber: company?.taxNumber || '',
      commercialRegisterNo: company?.commercialRegisterNo || '',
      registerCourt: company?.registerCourt || '',
      logoPath: company?.logoPath || '',
      bankId: company?.bank?.id || null,
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
        phone: company?.contact?.phone || '',
        mobilePhone: company?.contact?.mobilePhone || '',
        homepage: company?.contact?.homepage || ''
      }
    },
    onSubmit: async ({ value }) => {
      // For new companies the picked logo path is passed through so the
      // repository/form owner can upload it after the company id exists.
      onSubmit(company ? { ...value, id: company.id, logoPath: logoPreview } : { ...value, logoSourcePath: logoPreview })
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
        <h3 className="text-lg font-semibold">Company Information</h3>

        <form.Field name="name">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="name">Company Name *</Label>
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

        <div className="grid grid-cols-2 gap-4">
          <form.Field name="vatNumber">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="vatNumber">VAT Number</Label>
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
                <Label htmlFor="ustNumber">USt Number</Label>
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
                <Label htmlFor="taxNumber">Tax Number (Steuernummer)</Label>
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
                <Label htmlFor="commercialRegisterNo">Commercial Register No. (HR-Nr.)</Label>
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
                <Label htmlFor="registerCourt">Register Court (Amtsgericht)</Label>
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

        <div className="space-y-2">
          <Label>Invoice Logo (optional)</Label>
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
                No logo
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                Choose image...
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
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>

        <form.Field name="bankId">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="bankId">Bank (Optional)</Label>
              {banks.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading banks...</p>
              ) : banks.data && banks.data.length > 0 ? (
                <Select
                  value={field.state.value?.toString() || ''}
                  onValueChange={(value) => field.handleChange(value ? Number(value) : null)}
                >
                  <SelectTrigger id="bankId">
                    <SelectValue placeholder="Select a bank" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {banks.data.map((bank) => (
                      <SelectItem key={bank.id} value={bank.id.toString()}>
                        {bank.bankName} - {bank.accountHolder}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No banks available. Create a bank first in the Banks page.
                </p>
              )}
            </div>
          )}
        </form.Field>

        <form.Field name="notes">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
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

      <ContactFormFields form={form} />

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save Company</Button>
      </div>
    </form>
  )
}
