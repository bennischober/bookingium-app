import { useMemo, useState } from 'react'
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
import { type MarketingFileDto } from '../../../../../main/api/schemas/marketing.schema'
import { AtlasPicker } from './AtlasPicker'
import { t } from '../../../../../main/i18n/translate'

/**
 * "Marketing-Atlas importieren": a file is picked, then the entries for the working list are
 * chosen (A, what is already on it and what the team worked on are suggested); the rest of the
 * atlas waits in the pool. Contacts are created for the chosen entries only.
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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [createContacts, setCreateContacts] = useState(true)
  const [contactLists, setContactLists] = useState(false)
  const pick = trpcReact.marketing.pickAtlas.useMutation({
    onSuccess: (picked) => {
      if (!picked) return
      setFile(picked)
      setSelected(new Set(picked.entries.filter((entry) => entry.picked).map((e) => e.key)))
    },
    onError: (error) => toast.error(t('Datei nicht lesbar'), { description: error.message })
  })
  const close = () => {
    setFile(null)
    onOpenChange(false)
  }
  const run = trpcReact.marketing.importAtlas.useMutation({
    onSuccess: async (result) => {
      await utils.invalidate()
      toast.success(t('Marketing-Atlas importiert'), {
        description: [
          t('{{picked}} auf der Liste', { picked: result.picked }),
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
      close()
    },
    onError: (error) => toast.error(t('Import fehlgeschlagen'), { description: error.message })
  })
  const otherBand = file?.band && file.band.trim().toLowerCase() !== bandName.trim().toLowerCase()
  const newCount = useMemo(() => file?.entries.filter((e) => e.isNew).length ?? 0, [file])

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className={file ? 'max-w-4xl' : 'max-w-lg'}>
        <DialogHeader>
          <DialogTitle>{t('Marketing-Atlas importieren')}</DialogTitle>
          <DialogDescription>
            {file
              ? t(
                  'Wähle, was auf die Arbeitsliste kommt. Der Rest bleibt im Atlas und lässt sich später über „Auswahl bearbeiten…“ dazunehmen.'
                )
              : t(
                  'Die Atlas-Datei (.json) der Band. Ein neuer Stand aktualisiert die Einträge; Status, Notizen und Verknüpfungen bleiben.'
                )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size={file ? 'sm' : 'default'}
              className="gap-2"
              disabled={pick.isPending}
              onClick={() => pick.mutate(bandId)}
            >
              <FileUp className="h-4 w-4" />
              {file ? t('Andere Datei wählen…') : t('Datei wählen…')}
            </Button>
            {file && (
              <span className="text-muted-foreground">
                {[
                  file.fileName,
                  file.band,
                  file.stand && t('Stand {{stand}}', { stand: file.stand }),
                  t('{{total}} Einträge', { total: file.entries.length }),
                  newCount > 0 && t('{{count}} neu', { count: newCount })
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
          </div>
          {file && otherBand && (
            <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {t('Die Datei gehört zu „')}
              {file.band}
              {t('“, nicht zu „')}
              {bandName}“.
            </p>
          )}

          {file && (
            <AtlasPicker entries={file.entries} selected={selected} onChange={setSelected} />
          )}

          {file && (
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-primary"
                  checked={createContacts}
                  onChange={(event) => setCreateContacts(event.target.checked)}
                />
                <span>
                  {t('Kontakte für die Auswahl anlegen')}
                  <span className="block text-xs text-muted-foreground">
                    {t(
                      'Radios, Podcasts und Presse werden Medien-Firmen, Clubs und Festivals Orte.'
                    )}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
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
            </div>
          )}
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-sm text-muted-foreground">
            {file &&
              t('{{selected}} von {{total}} ausgewählt', {
                selected: selected.size,
                total: file.entries.length
              })}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={close}>
              {t('Abbrechen')}
            </Button>
            <Button
              disabled={!file || run.isPending}
              onClick={() =>
                file &&
                run.mutate({
                  bandId,
                  path: file.path,
                  picked: [...selected],
                  createContacts,
                  contactLists
                })
              }
            >
              {run.isPending ? t('Wird importiert…') : t('Importieren')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
