import { useState } from 'react'
import { AlertTriangle, FileUp } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  MARKETING_CATEGORY_LABELS,
  type MarketingContactScope,
  type MarketingFileDto
} from '../../../../../main/api/schemas/marketing.schema'

const SCOPES: Array<{ value: MarketingContactScope; label: string; hint: string }> = [
  {
    value: 'ab',
    label: 'Priorität A und B',
    hint: 'Radios, Podcasts und Presse werden Medien-Firmen, Clubs und Festivals Orte.'
  },
  { value: 'all', label: 'Alle Einträge', hint: 'Auch C-Einträge kommen ins Adressbuch.' },
  {
    value: 'none',
    label: 'Keine neuen Kontakte',
    hint: 'Nur vorhandene Firmen und Orte mit gleichem Namen werden verknüpft.'
  }
]

/**
 * "Marketing-Atlas importieren": a file is picked, its content shown (band, stand, entries per
 * tab), then imported into this band. Contacts and member lists are options.
 */
export function MarketingImportDialog({
  bandId,
  bandName,
  open,
  onOpenChange
}: {
  bandId: number
  bandName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const utils = trpcReact.useUtils()
  const [file, setFile] = useState<MarketingFileDto | null>(null)
  const [contacts, setContacts] = useState<MarketingContactScope>('ab')
  const [contactLists, setContactLists] = useState(false)
  const pick = trpcReact.marketing.pickAtlas.useMutation({
    onSuccess: (picked) => picked && setFile(picked),
    onError: (error) => toast.error('Datei nicht lesbar', { description: error.message })
  })
  const run = trpcReact.marketing.importAtlas.useMutation({
    onSuccess: async (result) => {
      await utils.invalidate()
      toast.success('Marketing-Atlas importiert', {
        description: [
          `${result.created} neu, ${result.updated} aktualisiert`,
          result.dropped > 0 && `${result.dropped} nicht mehr im Atlas`,
          result.companiesCreated + result.venuesCreated > 0 &&
            `${result.companiesCreated + result.venuesCreated} Kontakte angelegt`,
          result.linked > 0 && `${result.linked} verknüpft`,
          result.lists > 0 && `${result.lists} Verteiler`
        ]
          .filter(Boolean)
          .join(' · ')
      })
      setFile(null)
      onOpenChange(false)
    },
    onError: (error) => toast.error('Import fehlgeschlagen', { description: error.message })
  })
  const otherBand = file?.band && file.band.trim().toLowerCase() !== bandName.trim().toLowerCase()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setFile(null)
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Marketing-Atlas importieren</DialogTitle>
          <DialogDescription>
            Die Atlas-Datei (.json) von {bandName}. Ein neuer Stand aktualisiert die Einträge;
            Status, Notizen und Verknüpfungen bleiben.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <Button
            variant="outline"
            className="gap-2"
            disabled={pick.isPending}
            onClick={() => pick.mutate()}
          >
            <FileUp className="h-4 w-4" />
            {file ? 'Andere Datei wählen…' : 'Datei wählen…'}
          </Button>

          {file && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="font-medium">{file.fileName}</p>
              <p className="text-muted-foreground">
                {[file.band, file.stand && `Stand ${file.stand}`, `${file.total} Einträge`]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="text-muted-foreground">
                {file.counts
                  .map((entry) => `${MARKETING_CATEGORY_LABELS[entry.category]} ${entry.count}`)
                  .join(', ')}
              </p>
              {otherBand && (
                <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  Die Datei gehört zu „{file.band}“, nicht zu „{bandName}“.
                </p>
              )}
            </div>
          )}

          {file && (
            <fieldset className="space-y-2">
              <legend className="mb-1 font-medium">Kontakte ins Adressbuch</legend>
              {SCOPES.map((scope) => (
                <label key={scope.value} className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="marketing-contacts"
                    className="mt-1 accent-primary"
                    checked={contacts === scope.value}
                    onChange={() => setContacts(scope.value)}
                  />
                  <span>
                    {scope.label}
                    <span className="block text-xs text-muted-foreground">{scope.hint}</span>
                  </span>
                </label>
              ))}
              <label className="flex items-start gap-2 pt-1">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-primary"
                  checked={contactLists}
                  onChange={(event) => setContactLists(event.target.checked)}
                />
                <span>
                  Je Reiter einen Verteiler anlegen
                  <span className="block text-xs text-muted-foreground">
                    „Marketing-Atlas {bandName} – Radios“ usw. mit den verknüpften Kontakten.
                  </span>
                </span>
              </label>
            </fieldset>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            disabled={!file || run.isPending}
            onClick={() => file && run.mutate({ bandId, path: file.path, contacts, contactLists })}
          >
            {run.isPending ? 'Wird importiert…' : 'Importieren'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
