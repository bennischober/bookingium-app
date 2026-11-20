import { useMemo, useState } from 'react'
import { AlertTriangle, FileText, FolderOpen, FolderInput, Upload } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { DropOverlay } from '@/components/ui/drop-overlay'
import { useFileDrop } from '@/hooks/useFileDrop'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  SHOW_FOLDER_GROUPS,
  type ShowFolderPlanDto
} from '../../../../main/api/schemas/show_folder.schema'
import { SHOW_FILE_KIND_LABELS } from '../../../../main/showfolder/extract'
import { t } from '../../../../main/i18n/translate'

type FileChoice = { include: boolean; owner: 'event' | 'venue' }

/**
 * "Show-Ordner einlesen": the agency's folder of a show (or some of its files) is dropped or
 * picked; the dialog shows where each file goes and what it says for the event, club, hotel
 * and contacts. Only what stays ticked is taken over.
 */
export function ShowFolderDialog({
  eventId,
  open,
  onOpenChange
}: {
  eventId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const utils = trpcReact.useUtils()
  const [plan, setPlan] = useState<ShowFolderPlanDto | null>(null)
  const [files, setFiles] = useState<Record<string, FileChoice>>({})
  const [ticked, setTicked] = useState<Set<string>>(new Set())

  const analyze = trpcReact.showFolder.analyze.useMutation({
    onSuccess: (next) => {
      setPlan(next)
      setFiles(
        Object.fromEntries(
          next.files.map((file) => [
            file.path,
            { include: file.include, owner: file.owner === 'venue' ? 'venue' : 'event' }
          ])
        )
      )
      setTicked(new Set(next.suggestions.filter((s) => s.include).map((s) => s.id)))
    },
    onError: (error) =>
      toast.error(t('Show-Ordner konnte nicht gelesen werden'), { description: error.message })
  })
  const apply = trpcReact.showFolder.apply.useMutation({
    onSuccess: (result) => {
      void utils.invalidate()
      if (result.problems.length > 0) {
        toast.warning(t('Nicht alles übernommen'), { description: result.problems.join('\n') })
      } else {
        toast.success(t('Show-Ordner übernommen'), {
          description: t('{{changes}} Angaben und {{documents}} Dateien gespeichert.', {
            changes: result.changes,
            documents: result.documents
          })
        })
      }
      close()
    },
    onError: (error) => toast.error(t('Übernahme fehlgeschlagen'), { description: error.message })
  })

  const close = () => {
    setPlan(null)
    setFiles({})
    setTicked(new Set())
    onOpenChange(false)
  }

  const read = (paths: string[]) => {
    if (paths.length > 0) analyze.mutate({ eventId, paths })
  }

  const { dragging, dropProps } = useFileDrop({
    disabled: analyze.isPending || apply.isPending,
    onFiles: (paths) => read(paths)
  })

  const groups = useMemo(
    () =>
      SHOW_FOLDER_GROUPS.map((group) => ({
        group,
        items: (plan?.suggestions ?? []).filter((s) => s.group === group)
      })).filter((entry) => entry.items.length > 0),
    [plan]
  )

  const chosenFiles = plan ? plan.files.filter((file) => files[file.path]?.include) : []
  const chosenSuggestions = plan ? plan.suggestions.filter((s) => ticked.has(s.id)) : []
  const nothingChosen = chosenFiles.length === 0 && chosenSuggestions.length === 0

  const toggle = (id: string, on: boolean) =>
    setTicked((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const submit = () => {
    if (!plan) return
    apply.mutate({
      eventId,
      files: chosenFiles.map((file) => ({
        path: file.path,
        owner: files[file.path].owner,
        documentType: file.documentType
      })),
      actions: chosenSuggestions.map((s) => s.action)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (apply.isPending) return
        if (next) onOpenChange(true)
        else close()
      }}
    >
      <DialogContent className="flex max-h-[calc(100vh-4rem)] w-[calc(100vw-2rem)] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>{t('Show-Ordner einlesen')}</DialogTitle>
          <DialogDescription>
            {plan
              ? t(
                  'Prüfen, was übernommen wird. Vorschläge, die einen gespeicherten Wert ersetzen würden, sind nicht angehakt.'
                )
              : t(
                  'Den Ordner der Agentur zu dieser Show (Dropbox o. ä.) oder einzelne Dateien hierher ziehen: Day-/Infosheet, Club-Infos, Mails, Pläne, Vertrag, Abrechnung.'
                )}
          </DialogDescription>
        </DialogHeader>

        {!plan && (
          <div
            className="relative flex min-h-64 flex-1 flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-6 text-center"
            {...dropProps}
            data-testid="show-folder-drop"
          >
            <DropOverlay
              show={dragging}
              title={t('Hier ablegen')}
              hint={t('Ordner oder Dateien')}
            />
            {analyze.isPending ? (
              <>
                <Spinner className="size-8" />
                <p className="text-sm text-muted-foreground">{t('Dateien werden gelesen…')}</p>
              </>
            ) : (
              <>
                <Upload className="h-10 w-10 text-muted-foreground" />
                <p className="max-w-md text-sm text-muted-foreground">
                  {t(
                    'Ordner oder Dateien hierher ziehen. Gelesen werden PDF, E-Mails (.eml) und die Abrechnung (.xlsx); alles andere wird nur abgelegt. Nichts wird geändert, bevor Sie die Vorschläge bestätigen.'
                  )}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    variant="outline"
                    onClick={async () => read(await window.api.pickShowFolder('folder'))}
                  >
                    <FolderOpen className="h-4 w-4" />
                    {t('Ordner wählen…')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={async () => read(await window.api.pickShowFolder('files'))}
                  >
                    <FileText className="h-4 w-4" />
                    {t('Dateien wählen…')}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {plan && (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            {plan.hints.length > 0 && (
              <ul className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                {plan.hints.map((hint) => (
                  <li key={hint} className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    {hint}
                  </li>
                ))}
              </ul>
            )}

            {groups.map(({ group, items }) => (
              <section key={group} className="space-y-2">
                <h3 className="text-sm font-semibold">{group}</h3>
                <ul className="divide-y rounded-md border">
                  {items.map((s) => (
                    <li key={s.id} className="px-3 py-2 text-sm">
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 accent-primary"
                          checked={ticked.has(s.id)}
                          onChange={(e) => toggle(s.id, e.target.checked)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{s.label}</span>
                          <span className="block break-words">
                            {s.current && (
                              <>
                                <span className="text-muted-foreground line-through">
                                  {s.current}
                                </span>{' '}
                                →{' '}
                              </>
                            )}
                            {s.proposed}
                          </span>
                          {s.source && (
                            <span className="block text-xs text-muted-foreground">
                              {t('aus „{{source}}“', { source: s.source })}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t('Dateien ablegen')}</h3>
              <ul className="divide-y rounded-md border">
                {plan.files.map((file) => {
                  const choice = files[file.path]
                  return (
                    <li
                      key={file.path}
                      className={cn(
                        'flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm',
                        !choice?.include && 'text-muted-foreground'
                      )}
                    >
                      <input
                        type="checkbox"
                        aria-label={t('{{name}} ablegen', { name: file.name })}
                        className="h-4 w-4 accent-primary"
                        checked={choice?.include ?? false}
                        onChange={(e) =>
                          setFiles((current) => ({
                            ...current,
                            [file.path]: { ...current[file.path], include: e.target.checked }
                          }))
                        }
                      />
                      <span className="min-w-0 flex-1 truncate" title={file.path}>
                        {file.name}
                      </span>
                      <Badge variant="outline" className="font-normal">
                        {SHOW_FILE_KIND_LABELS[file.kind]}
                      </Badge>
                      <Select
                        value={choice?.owner ?? 'event'}
                        onValueChange={(owner) =>
                          setFiles((current) => ({
                            ...current,
                            [file.path]: {
                              ...current[file.path],
                              owner: owner as 'event' | 'venue'
                            }
                          }))
                        }
                        disabled={!choice?.include}
                      >
                        <SelectTrigger
                          className="h-7 w-auto gap-1 text-xs"
                          aria-label={t('Ablage')}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="event">{t('beim Event')}</SelectItem>
                          <SelectItem value="venue" disabled={!plan.venueName}>
                            {plan.venueName
                              ? t('beim Club {{name}}', { name: plan.venueName })
                              : t('beim Club')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {file.note && (
                        <span className="basis-full pl-7 text-xs text-muted-foreground">
                          {file.note}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          </div>
        )}

        {plan && (
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="ghost"
              onClick={() => setPlan(null)}
              disabled={apply.isPending}
              className="gap-1.5"
            >
              <FolderInput className="h-4 w-4" />
              {t('Andere Dateien')}
            </Button>
            <Button onClick={submit} disabled={nothingChosen || apply.isPending}>
              {apply.isPending && <Spinner className="size-4" />}
              {nothingChosen
                ? t('Nichts ausgewählt')
                : t('Übernehmen ({{suggestions}} Angaben, {{files}} Dateien)', {
                    suggestions: chosenSuggestions.length,
                    files: chosenFiles.length
                  })}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
