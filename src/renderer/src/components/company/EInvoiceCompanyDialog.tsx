import { useEffect, useId, useRef, useState } from 'react'
import { FileText, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { droppedFilePaths } from '@/components/documents/documentFiles'
import {
  COMPANY_MEMBER_ROLE_SUGGESTIONS,
  type EInvoicePartyInput,
  type EInvoicePartyMatch,
  type EInvoicePartyPreview,
  type EInvoicePartySource
} from '../../../../main/api/schemas/einvoice_party.schema'

// #222: a company and its people from a received e-invoice. The file is picked, dropped
// or handed over from a mail attachment; the user checks and completes what was read,
// adds people (e.g. further Geschäftsführer), and only then is anything written.

type Party = EInvoicePartyInput
type PersonRow = Party['persons'][number] & {
  /** Stable React key; rows can be removed */
  key: number
  /** From the preview; added rows have none */
  match?: EInvoicePartyMatch
  isMember?: boolean
}

const MATCH_LABELS: Record<NonNullable<EInvoicePartyMatch>['by'], string> = {
  vatId: 'USt-IdNr.',
  taxNumber: 'Steuernummer',
  name: 'Namen',
  email: 'E-Mail-Adresse'
}

const ROLE_LIST_ID = 'einvoice-company-roles'

let nextKey = 1

function rowsOf(preview: EInvoicePartyPreview): PersonRow[] {
  return preview.party.persons.map((person, index) => ({
    ...person,
    key: nextKey++,
    match: preview.persons[index]?.match ?? null,
    isMember: preview.persons[index]?.isMember ?? false
  }))
}

function Field({
  label,
  value,
  onChange,
  className,
  placeholder
}: {
  label: string
  value: string
  onChange: (value: string) => void
  className?: string
  placeholder?: string
}) {
  const id = useId()
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1 block text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function PersonStatus({ row, companyMatched }: { row: PersonRow; companyMatched: boolean }) {
  if (row.match === undefined) return <Badge variant="outline">hinzugefügt</Badge>
  if (row.match === null) return <Badge variant="secondary">neu</Badge>
  const label =
    row.isMember && companyMatched ? 'bereits zugeordnet' : `vorhanden (${row.match.name})`
  return (
    <Badge variant="outline" title={`Gefunden über ${MATCH_LABELS[row.match.by]}`}>
      {label}
    </Badge>
  )
}

export function EInvoiceCompanyDialog({
  open,
  onOpenChange,
  source,
  onSaved
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Read right away (mail attachment); without one the dialog asks for a file */
  source?: EInvoicePartySource | null
  /** After the write, with the company's id */
  onSaved?: (companyId: number) => void
}) {
  const utils = trpcReact.useUtils()
  const [preview, setPreview] = useState<EInvoicePartyPreview | null>(null)
  const [party, setParty] = useState<Party | null>(null)
  const [persons, setPersons] = useState<PersonRow[]>([])
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  const read = trpcReact.einvoiceParty.read.useMutation({
    onSuccess: (result) => {
      setPreview(result)
      setParty(result.party)
      setPersons(rowsOf(result))
    },
    onError: (error) =>
      toast.error('E-Rechnung konnte nicht gelesen werden', { description: error.message })
  })

  const apply = trpcReact.einvoiceParty.apply.useMutation({
    onSuccess: (result) => {
      void utils.company.invalidate()
      void utils.person.invalidate()
      void utils.relation.invalidate()
      const people =
        result.personsCreated + result.membersAdded > 0
          ? ` · ${result.membersAdded} ${result.membersAdded === 1 ? 'Person' : 'Personen'} zugeordnet`
          : ''
      toast.success(result.companyCreated ? 'Firma angelegt' : 'Firma ergänzt', {
        description: `${party?.name ?? ''}${people}`
      })
      onOpenChange(false)
      onSaved?.(result.companyId)
    },
    onError: (error) => toast.error('Speichern fehlgeschlagen', { description: error.message })
  })

  // A new source (or reopening) starts over
  const sourceKey = source ? JSON.stringify(source) : ''
  const readFor = useRef<string | null>(null)
  useEffect(() => {
    if (!open) {
      readFor.current = null
      return
    }
    // Strict Mode runs the effect twice; each opened source is read once
    if (readFor.current === sourceKey) return
    readFor.current = sourceKey
    setPreview(null)
    setParty(null)
    setPersons([])
    if (source) read.mutate(source)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opened source
  }, [open, sourceKey])

  const readPath = (path: string) => read.mutate({ kind: 'file', path })

  const pickFile = async () => {
    const path = await window.api.pickEInvoiceFile()
    if (path) readPath(path)
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const [path] = droppedFilePaths(e)
    if (!path) {
      toast.error('Datei konnte nicht gelesen werden', {
        description:
          'Diese Drag-Quelle stellt keine lokale Datei bereit. Bitte „Datei wählen…“ verwenden.'
      })
      return
    }
    readPath(path)
  }

  const set = <K extends keyof Party>(field: K, value: Party[K]) =>
    setParty((current) => (current ? { ...current, [field]: value } : current))
  const setAddress = (field: keyof Party['address'], value: string) =>
    setParty((current) =>
      current ? { ...current, address: { ...current.address, [field]: value } } : current
    )
  const setBank = (field: keyof Party['bank'], value: string) =>
    setParty((current) =>
      current ? { ...current, bank: { ...current.bank, [field]: value } } : current
    )
  const setPerson = (key: number, field: keyof Party['persons'][number], value: string) =>
    setPersons((rows) => rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)))

  const addPerson = () =>
    setPersons((rows) => [
      ...rows,
      { key: nextKey++, firstName: '', lastName: '', email: '', phone: '', role: 'Geschäftsführer' }
    ])

  const save = () => {
    if (!party) return
    if (!party.name.trim()) {
      toast.error('Bitte einen Firmennamen angeben')
      return
    }
    // Rows left completely empty are dropped; a row with data needs a first name
    const filled = persons.filter((row) =>
      [row.firstName, row.lastName, row.email, row.phone].some((value) => value.trim())
    )
    if (filled.some((row) => !row.firstName.trim())) {
      toast.error('Bitte bei jeder Person einen Vornamen angeben')
      return
    }
    apply.mutate({
      ...party,
      address: { ...party.address, countryCode: party.address.countryCode.trim().toUpperCase() },
      persons: filled.map(({ firstName, lastName, email, phone, role }) => ({
        firstName,
        lastName,
        email,
        phone,
        role
      }))
    })
  }

  const company = preview?.company ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Firma aus E-Rechnung</DialogTitle>
          <DialogDescription>
            Liest den Rechnungssteller aus einer E-Rechnung (ZUGFeRD, Factur-X oder XRechnung). Sie
            prüfen die Angaben, bevor etwas gespeichert wird.
          </DialogDescription>
        </DialogHeader>

        {read.isPending && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
            <Spinner /> E-Rechnung wird gelesen…
          </div>
        )}

        {!read.isPending && !party && (
          <div
            className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-10 text-center ${
              dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
            }`}
            onDragEnter={(e) => {
              e.preventDefault()
              dragDepth.current++
              setDragging(true)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              dragDepth.current = Math.max(0, dragDepth.current - 1)
              if (dragDepth.current === 0) setDragging(false)
            }}
            onDrop={onDrop}
          >
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm">E-Rechnung (PDF oder XML) hier ablegen</p>
            <Button variant="outline" onClick={() => void pickFile()}>
              Datei wählen…
            </Button>
          </div>
        )}

        {!read.isPending && party && preview && (
          <div className="-mx-6 flex-1 space-y-6 overflow-y-auto px-6">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              {preview.fileName && <span>{preview.fileName}</span>}
              {preview.invoiceNumber && <span>· Rechnung {preview.invoiceNumber}</span>}
              {preview.issueDate && (
                <span>· {new Date(preview.issueDate).toLocaleDateString('de-DE')}</span>
              )}
            </div>

            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium">Firma</h3>
                {company ? (
                  <Badge variant="outline">
                    Vorhanden: {company.name} (gefunden über {MATCH_LABELS[company.by]})
                  </Badge>
                ) : (
                  <Badge variant="secondary">wird neu angelegt</Badge>
                )}
              </div>
              {company && (
                <p className="text-xs text-muted-foreground">
                  Bei der vorhandenen Firma werden nur leere Felder ergänzt; was dort schon steht,
                  bleibt.
                </p>
              )}
              <div className="grid grid-cols-6 gap-3">
                <Field
                  className="col-span-6"
                  label="Firmenname"
                  value={party.name}
                  onChange={(v) => set('name', v)}
                />
                <Field
                  className="col-span-3"
                  label="USt-IdNr."
                  value={party.vatId}
                  onChange={(v) => set('vatId', v)}
                />
                <Field
                  className="col-span-3"
                  label="Steuernummer"
                  value={party.taxNumber}
                  onChange={(v) => set('taxNumber', v)}
                />
                <Field
                  className="col-span-3"
                  label="Handelsregister"
                  value={party.commercialRegisterNo}
                  onChange={(v) => set('commercialRegisterNo', v)}
                />
                <Field
                  className="col-span-3"
                  label="Registergericht"
                  value={party.registerCourt}
                  onChange={(v) => set('registerCourt', v)}
                />
                <Field
                  className="col-span-3"
                  label="E-Mail"
                  value={party.email}
                  onChange={(v) => set('email', v)}
                />
                <Field
                  className="col-span-3"
                  label="Telefon"
                  value={party.phone}
                  onChange={(v) => set('phone', v)}
                />
                <Field
                  className="col-span-4"
                  label="Straße"
                  value={party.address.street}
                  onChange={(v) => setAddress('street', v)}
                />
                <Field
                  className="col-span-2"
                  label="Hausnummer"
                  value={party.address.streetNumber}
                  onChange={(v) => setAddress('streetNumber', v)}
                />
                <Field
                  className="col-span-6"
                  label="Adresszusatz"
                  value={party.address.addressSuffix}
                  onChange={(v) => setAddress('addressSuffix', v)}
                />
                <Field
                  className="col-span-2"
                  label="PLZ"
                  value={party.address.zipCode}
                  onChange={(v) => setAddress('zipCode', v)}
                />
                <Field
                  className="col-span-3"
                  label="Ort"
                  value={party.address.city}
                  onChange={(v) => setAddress('city', v)}
                />
                <Field
                  className="col-span-1"
                  label="Land"
                  value={party.address.countryCode}
                  placeholder="DE"
                  onChange={(v) => setAddress('countryCode', v)}
                />
                <Field
                  className="col-span-3"
                  label="IBAN"
                  value={party.bank.iban}
                  onChange={(v) => setBank('iban', v)}
                />
                <Field
                  className="col-span-3"
                  label="BIC"
                  value={party.bank.bic}
                  onChange={(v) => setBank('bic', v)}
                />
                <Field
                  className="col-span-6"
                  label="Kontoinhaber"
                  value={party.bank.accountHolder}
                  onChange={(v) => setBank('accountHolder', v)}
                />
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">Personen</h3>
                <Button variant="outline" size="sm" onClick={addPerson}>
                  <Plus className="h-4 w-4" />
                  Person hinzufügen
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Der Ansprechpartner der Rechnung wird als „Kontakt“ übernommen, Geschäftsführer aus
                den Rechtsangaben, soweit die Rechnung sie nennt. Weitere Personen tragen Sie hier
                ein.
              </p>
              {persons.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Die E-Rechnung nennt keine Personen.
                </p>
              )}
              <datalist id={ROLE_LIST_ID}>
                {COMPANY_MEMBER_ROLE_SUGGESTIONS.map((role) => (
                  <option key={role} value={role} />
                ))}
              </datalist>
              {persons.map((row) => (
                <div key={row.key} className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <PersonStatus row={row} companyMatched={company !== null} />
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Person entfernen"
                      title="Nicht übernehmen"
                      onClick={() => setPersons((rows) => rows.filter((r) => r.key !== row.key))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-6 gap-3">
                    <Field
                      className="col-span-2"
                      label="Vorname"
                      value={row.firstName}
                      onChange={(v) => setPerson(row.key, 'firstName', v)}
                    />
                    <Field
                      className="col-span-2"
                      label="Nachname"
                      value={row.lastName}
                      onChange={(v) => setPerson(row.key, 'lastName', v)}
                    />
                    <div className="col-span-2">
                      <Label
                        htmlFor={`einvoice-role-${row.key}`}
                        className="mb-1 block text-xs text-muted-foreground"
                      >
                        Rolle
                      </Label>
                      <Input
                        id={`einvoice-role-${row.key}`}
                        list={ROLE_LIST_ID}
                        value={row.role}
                        onChange={(e) => setPerson(row.key, 'role', e.target.value)}
                      />
                    </div>
                    <Field
                      className="col-span-3"
                      label="E-Mail"
                      value={row.email}
                      onChange={(v) => setPerson(row.key, 'email', v)}
                    />
                    <Field
                      className="col-span-3"
                      label="Telefon"
                      value={row.phone}
                      onChange={(v) => setPerson(row.key, 'phone', v)}
                    />
                  </div>
                </div>
              ))}
            </section>
          </div>
        )}

        <DialogFooter>
          {party && !source && (
            <Button
              variant="ghost"
              className="mr-auto"
              onClick={() => {
                setPreview(null)
                setParty(null)
                setPersons([])
              }}
              disabled={apply.isPending}
            >
              Andere Datei
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={save} disabled={!party || apply.isPending}>
            {apply.isPending ? 'Wird gespeichert…' : company ? 'Firma ergänzen' : 'Firma anlegen'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
