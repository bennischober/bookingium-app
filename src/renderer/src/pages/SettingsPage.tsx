import { SearchableSelect } from '@/components/ui/searchable-select'
import { useState } from 'react'
import { DatabaseBackup, Download, FolderOpen, Upload } from 'lucide-react'
import { useExportToast } from '@/components/export/ExportButton'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { InvoiceNumberingCard } from '@/components/invoice/InvoiceNumberingCard'
import { ImportDialog } from '@/components/import/ImportDialog'
import { IMPORT_COUNTRY_OPTIONS } from '../../../main/api/schemas/import.schema'

const NONE = 'none'

/** Default own company and default country */
function GeneralCard() {
  const utils = trpcReact.useUtils()
  const companies = trpcReact.company.getListItems.useQuery()
  const defaultCompany = trpcReact.company.getDefaultForInvoicing.useQuery()
  const settings = trpcReact.settings.get.useQuery()

  const setDefaultCompany = trpcReact.company.setDefaultForInvoicing.useMutation({
    onSuccess: () => {
      void utils.company.invalidate()
      toast.success('Eigene Firma gespeichert')
    },
    onError: (error) =>
      toast.error('Eigene Firma konnte nicht gespeichert werden', { description: error.message })
  })

  const updateSettings = trpcReact.settings.update.useMutation({
    onSuccess: (saved) => {
      utils.settings.get.setData(undefined, saved)
      toast.success('Einstellung gespeichert')
    },
    onError: (error) =>
      toast.error('Einstellung konnte nicht gespeichert werden', { description: error.message })
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Allgemein</CardTitle>
        <CardDescription>Voreinstellungen für Rechnungen, Verträge und Importe.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="settings-own-company">Eigene Firma</Label>
          <SearchableSelect
            id="settings-own-company"
            value={defaultCompany.data?.id ?? null}
            onChange={(value) => setDefaultCompany.mutate(value)}
            options={(companies.data ?? []).map((company) => ({
              value: company.id,
              label: company.name
            }))}
            noneLabel="Keine"
            searchPlaceholder="Firma suchen…"
            disabled={defaultCompany.isLoading || setDefaultCompany.isPending}
          />
          <p className="text-xs text-muted-foreground">
            Stellt Rechnungen aus und vertritt Bands ohne eigenes Management in Verträgen.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="settings-country">Standardland</Label>
          <Select
            value={settings.data?.defaultCountry || NONE}
            onValueChange={(value) =>
              updateSettings.mutate({ defaultCountry: value === NONE ? '' : value })
            }
            disabled={settings.isLoading || updateSettings.isPending}
          >
            <SelectTrigger id="settings-country">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Keins</SelectItem>
              {IMPORT_COUNTRY_OPTIONS.map((country) => (
                <SelectItem key={country.code} value={country.code}>
                  {country.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Für importierte Einträge ohne Land (außer bei Tabellen namens „international“).
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

/** Import, backup and where the data lives */
function DataCard() {
  const [importOpen, setImportOpen] = useState(false)
  const locations = trpcReact.settings.dataLocations.useQuery()
  const openDataFolder = trpcReact.settings.openDataFolder.useMutation({
    onError: (error) =>
      toast.error('Ordner konnte nicht geöffnet werden', { description: error.message })
  })
  const openBackup = trpcReact.settings.openBackup.useMutation()
  const showExport = useExportToast()
  const exportAll = trpcReact.dataExport.exportAll.useMutation({
    onSuccess: showExport,
    onError: (error) => toast.error('Export fehlgeschlagen', { description: error.message })
  })
  const createBackup = trpcReact.settings.createBackup.useMutation({
    onSuccess: (result) => {
      if (result.canceled || !result.folder) return
      const folder = result.folder
      toast.success('Sicherung erstellt', {
        description: folder,
        action: { label: 'Öffnen', onClick: () => openBackup.mutate(folder) }
      })
    },
    onError: (error) => toast.error('Sicherung fehlgeschlagen', { description: error.message })
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daten</CardTitle>
        <CardDescription>
          Listen importieren und exportieren, Daten sichern und Speicherort.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">Import</p>
            <p className="text-sm text-muted-foreground">
              Excel-Listen übernehmen; vorhandene Einträge werden nur ergänzt.
            </p>
          </div>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" /> Daten importieren…
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">Export</p>
            <p className="text-sm text-muted-foreground">
              Alle Listen als Excel-Datei, ein Tabellenblatt je Liste. Einzelne Listen lassen sich
              auf ihrer Seite exportieren.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => exportAll.mutate()}
            disabled={exportAll.isPending}
          >
            <Download className="h-4 w-4" />
            {exportAll.isPending ? 'Wird exportiert…' : 'Alles exportieren…'}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">Sicherung</p>
            <p className="text-sm text-muted-foreground">
              Kopiert Datenbank und Dokumente in einen neuen Ordner (mit Anleitung zum
              Wiederherstellen).
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => createBackup.mutate()}
            disabled={createBackup.isPending}
          >
            <DatabaseBackup className="h-4 w-4" />
            {createBackup.isPending ? 'Wird gesichert…' : 'Sicherung erstellen…'}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">Speicherort</p>
            <p
              className="truncate font-mono text-xs text-muted-foreground"
              title={locations.data?.dataFolder}
            >
              {locations.data?.dataFolder ?? '…'}
            </p>
          </div>
          <Button variant="outline" onClick={() => openDataFolder.mutate()}>
            <FolderOpen className="h-4 w-4" /> Datenordner öffnen
          </Button>
        </div>
      </CardContent>

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </Card>
  )
}

export default function SettingsPage() {
  return (
    <div className="flex w-full min-w-0 flex-col gap-8 p-6">
      <div>
        <h1 className="mb-2 text-2xl font-bold">Einstellungen</h1>
        <p className="text-sm text-muted-foreground">
          Voreinstellungen, Rechnungsnummern und Datenverwaltung.
        </p>
      </div>

      <div className="max-w-4xl space-y-6">
        <GeneralCard />
        <InvoiceNumberingCard />
        <DataCard />
      </div>
    </div>
  )
}
