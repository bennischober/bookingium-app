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
import { t } from '../../../../../main/i18n/translate'

const SCOPES: Array<{ value: MarketingContactScope; label: string; hint: string }> = [
  {
    value: 'ab',
    label: t('Priorität A und B'),
    hint: t('Radios, Podcasts und Presse werden Medien-Firmen, Clubs und Festivals Orte.')
  },
  { value: 'all', label: t('Alle Einträge'), hint: t('Auch C-Einträge kommen ins Adressbuch.') },
  {
    value: 'none',
    label: t('Keine neuen Kontakte'),
    hint: t('Nur vorhandene Firmen und Orte mit gleichem Namen werden verknüpft.')
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
    onError: (error) => toast.error(t('Datei nicht lesbar'), { description: error.message })
  })
  const run = trpcReact.marketing.importAtlas.useMutation({
    onSuccess: async (result) => {
      await utils.invalidate()
      toast.success(t('Marketing-Atlas importiert'), {
        description: [
          `${result.created} neu, ${result.updated} aktualisiert`,
          result.dropped > 0 && t('{{dropped}} nicht mehr im Atlas', { dropped: result.dropped }),
          result.companiesCreated + result.venuesCreated > 0 &&
            t('{{value}} Kontakte angelegt', {
              value: result.companiesCreated + result.venuesCreated
            }),
          result.linked > 0 && t('{{linked}} verknüpft', { linked: result.linked }),
          result.lists > 0 && t('{{lists}} Verteiler', { lists: result.lists })
        ]
          .filter(Boolean)
          .join(' · ')
      })
      setFile(null)
      onOpenChange(false)
    },
    onError: (error) => toast.error(t('Import fehlgeschlagen'), { description: error.message })
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
          <DialogTitle>{t('Marketing-Atlas importieren')}</DialogTitle>
          <DialogDescription>
            {t('Die Atlas-Datei (.json) von')} {bandName}
            {t(
              '. Ein neuer Stand aktualisiert die Einträge; Status, Notizen und Verknüpfungen bleiben.'
            )}
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
            {file ? t('Andere Datei wählen…') : t('Datei wählen…')}
          </Button>

          {file && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="font-medium">{file.fileName}</p>
              <p className="text-muted-foreground">
                {[
                  file.band,
                  file.stand && t('Stand {{stand}}', { stand: file.stand }),
                  t('{{total}} Einträge', { total: file.total })
                ]
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
                  {t('Die Datei gehört zu „')}
                  {file.band}
                  {t('“, nicht zu „')}
                  {bandName}“.
                </p>
              )}
            </div>
          )}

          {file && (
            <fieldset className="space-y-2">
              <legend className="mb-1 font-medium">{t('Kontakte ins Adressbuch')}</legend>
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
                  {t('Je Reiter einen Verteiler anlegen')}
                  <span className="block text-xs text-muted-foreground">
                    „Marketing-Atlas {bandName} {t('– Radios“ usw. mit den verknüpften Kontakten.')}
                  </span>
                </span>
              </label>
            </fieldset>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Abbrechen')}
          </Button>
          <Button
            disabled={!file || run.isPending}
            onClick={() => file && run.mutate({ bandId, path: file.path, contacts, contactLists })}
          >
            {run.isPending ? t('Wird importiert…') : t('Importieren')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
