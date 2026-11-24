import { useState } from 'react'
import { FileSpreadsheet, FolderOpen, UserMinus, UserPlus, Users } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { confirmAction } from '@/lib/confirm'
import { germanDate } from '@/lib/followUps'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ImportDialog } from '@/components/import/ImportDialog'
import type { EmployeeDto } from '../../../../main/api/schemas/staff.schema'
import { t } from '../../../../main/i18n/translate'

const showError = (title: string) => (error: { message: string }) =>
  toast.error(title, { description: error.message })

/**
 * #262 "Mitarbeiter" (Einstellungen › Daten): employees get a folder of their own, which this
 * computer fills with only what is shared with them (Freigaben on the band, event, invoice …
 * pages) and takes their changes back from.
 */
export function EmployeesCard() {
  const utils = trpcReact.useUtils()
  const list = trpcReact.staff.list.useQuery(undefined, { refetchInterval: 20_000 })
  const [adding, setAdding] = useState(false)
  // #262: the employee whose contacts come from an uploaded list
  const [sharingWith, setSharingWith] = useState<EmployeeDto | null>(null)
  const refresh = () => {
    void utils.staff.list.invalidate()
    void utils.staff.hasEmployees.invalidate()
    void utils.staff.grantState.invalidate()
  }
  const revoke = trpcReact.staff.revoke.useMutation({
    onSuccess: () => {
      refresh()
      toast.success(t('Zugang entzogen'))
    },
    onError: showError(t('Zugang konnte nicht entzogen werden'))
  })
  const remove = trpcReact.staff.remove.useMutation({
    onSuccess: refresh,
    onError: showError(t('Mitarbeiter konnte nicht entfernt werden'))
  })
  const employees = list.data ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          {t('Mitarbeiter')}
        </CardTitle>
        <CardDescription>
          {t(
            'Jeder Mitarbeiter bekommt einen eigenen Abgleich-Ordner, den dieser Computer nur mit freigegebenen Daten füllt: die für ihn freigegebenen Kontakte, die Events freigegebener Bands mit Club, Veranstalter und Hotel, und was einzeln freigegeben ist. Was er anlegt oder ändert, kommt in die Datenbank der Firma. Rechnungen legt er nur als Entwurf an, löschen kann er nur Eigenes.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {employees.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('Noch keine Mitarbeiter.')}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {employees.map((employee) => (
              <li
                key={employee.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">{employee.name}</p>
                  <p className="text-xs text-muted-foreground">{employeeState(employee)}</p>
                  {employee.folder && (
                    <p
                      className="truncate font-mono text-xs text-muted-foreground"
                      title={employee.folder}
                    >
                      {employee.folder}
                    </p>
                  )}
                  {employee.lastError && (
                    <p className="text-xs text-destructive">{employee.lastError}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  {employee.revokedAt ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(employee.id)}
                    >
                      {t('Entfernen')}
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        title={t(
                          'Eine Excel- oder CSV-Liste mit Kontakten: vorhandene werden erkannt, fehlende angelegt, alle für den Mitarbeiter freigegeben.'
                        )}
                        onClick={() => setSharingWith(employee)}
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                        {t('Kontakte aus Liste freigeben…')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={revoke.isPending}
                        onClick={() =>
                          void confirmAction({
                            title: t('Zugang von {{name}} entziehen?', { name: employee.name }),
                            description: t(
                              'Der Ordner wird nicht mehr befüllt, und Bookingium entfernt die Daten der Firma beim nächsten Abgleich vom Computer des Mitarbeiters. Was er angelegt hat, bleibt hier erhalten.'
                            ),
                            confirmLabel: t('Zugang entziehen'),
                            destructive: true
                          }).then((ok) => ok && revoke.mutate(employee.id))
                        }
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                        {t('Zugang entziehen')}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" className="gap-1.5" onClick={() => setAdding(true)}>
          <UserPlus className="h-4 w-4" />
          {t('Mitarbeiter hinzufügen…')}
        </Button>
      </CardContent>
      {sharingWith && (
        <ImportDialog
          open
          onOpenChange={(open) => {
            if (open) return
            setSharingWith(null)
            refresh()
          }}
          shareWith={{ id: sharingWith.id, name: sharingWith.name }}
        />
      )}
      {adding && (
        <AddEmployeeDialog
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false)
            refresh()
          }}
        />
      )}
    </Card>
  )
}

function employeeState(employee: EmployeeDto): string {
  if (employee.revokedAt)
    return t('Zugang entzogen am {{date}}', { date: germanDate(employee.revokedAt.slice(0, 10)) })
  if (!employee.bridgedHere) return t('Wird von einem anderen Computer der Firma bedient.')
  if (!employee.joined)
    return t('Wartet darauf, dass der Mitarbeiter dem Ordner auf seinem Computer beitritt.')
  return employee.lastChangeAt
    ? t('Verbunden, zuletzt geändert am {{date}}', {
        date: germanDate(employee.lastChangeAt.slice(0, 10))
      })
    : t('Verbunden')
}

/** Name and an empty folder the employee's computer sees too (shared via OneDrive etc.) */
function AddEmployeeDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const chooseFolder = trpcReact.staff.chooseFolder.useMutation({
    onSuccess: (chosen) => chosen && setFolder(chosen)
  })
  const create = trpcReact.staff.create.useMutation({
    onSuccess: (employee) => {
      toast.success(t('{{name}} hinzugefügt', { name: employee.name }), {
        description: t(
          'Jetzt den Ordner mit dem Mitarbeiter teilen. Auf seinem Computer: Einstellungen › Daten › Abgleich › diesen Ordner wählen und beitreten.'
        )
      })
      onAdded()
    },
    onError: showError(t('Mitarbeiter konnte nicht hinzugefügt werden'))
  })
  const ready = name.trim() !== '' && folder !== ''

  return (
    <Dialog open onOpenChange={(next) => !next && !create.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Mitarbeiter hinzufügen')}</DialogTitle>
          <DialogDescription>
            {t(
              'Wählen Sie einen leeren Ordner, den Sie mit dem Mitarbeiter teilen (OneDrive, Dropbox, Google Drive) – nicht den Abgleich-Ordner der Firma.'
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (ready && !create.isPending) create.mutate({ name: name.trim(), folder })
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="employee-name">{t('Name')}</Label>
            <Input
              id="employee-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label>{t('Ordner')}</Label>
            <div className="flex items-center gap-2">
              <p
                className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
                title={folder}
              >
                {folder || t('Noch kein Ordner gewählt')}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => chooseFolder.mutate()}
                disabled={chooseFolder.isPending}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {t('Wählen…')}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
              {t('Abbrechen')}
            </Button>
            <Button type="submit" disabled={!ready || create.isPending}>
              {create.isPending ? t('Wird eingerichtet…') : t('Hinzufügen')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
