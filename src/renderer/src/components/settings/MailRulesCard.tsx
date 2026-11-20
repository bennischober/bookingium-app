import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Trash2
} from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { mailApi } from '@/lib/mailApi'
import { confirmAction } from '@/lib/confirm'
import { parseTimestamp } from '@/lib/utils'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { RecordPicker } from '@/components/mail/RecordPicker'
import { AliasFolders } from './AliasFolders'
import { filterRules } from './mailRuleSearch'
import {
  RECORD_LABELS,
  useRecordChoices,
  type RecordChoice,
  type RecordType
} from '@/components/mail/recordChoices'
import { flattenFolders, folderLabel, isDrafts, isInbox } from '@/components/mail/format'
import type { MailRuleDto } from '../../../../main/api/schemas/mailRule.schema'
import { t, uiLocale } from '../../../../main/i18n/translate'

/** The Select's value for "do not move"; Radix refuses an empty value */
const NO_FOLDER = '__none__'

type Draft = {
  name: string
  accountId: string
  matchFrom: string
  matchTo: string
  matchSubject: string
  moveToFolderPath: string | null
  markRead: boolean
  markFlagged: boolean
  link: boolean
  linkType: RecordType
  linkChoice: RecordChoice | null
}

const draftOf = (rule: MailRuleDto | null, accountId: string): Draft =>
  rule
    ? {
        name: rule.name,
        accountId: rule.accountId,
        matchFrom: rule.matchFrom,
        matchTo: rule.matchTo,
        matchSubject: rule.matchSubject,
        moveToFolderPath: rule.moveToFolderPath,
        markRead: rule.markRead,
        markFlagged: rule.markFlagged,
        link: rule.link !== null,
        linkType: rule.link?.entityType ?? 'person',
        linkChoice: rule.link
          ? {
              id: rule.link.entityId,
              label:
                rule.link.label ??
                t('{{value}} (gelöscht)', { value: RECORD_LABELS[rule.link.entityType] })
            }
          : null
      }
    : {
        name: '',
        accountId,
        matchFrom: '',
        matchTo: '',
        matchSubject: '',
        moveToFolderPath: null,
        markRead: false,
        markFlagged: false,
        link: false,
        linkType: 'person',
        linkChoice: null
      }

/** What a rule does, in one line for the list */
function ruleSummary(rule: MailRuleDto): string {
  const conditions = [
    rule.matchFrom && t('Absender enthält „{{matchFrom}}“', { matchFrom: rule.matchFrom }),
    rule.matchTo && t('An/Cc enthält „{{matchTo}}“', { matchTo: rule.matchTo }),
    rule.matchSubject &&
      t('Betreff enthält „{{matchSubject}}“', { matchSubject: rule.matchSubject })
  ].filter(Boolean)
  const actions = [
    rule.markRead && t('als gelesen markieren'),
    rule.markFlagged && t('mit Fähnchen markieren'),
    rule.moveToFolderPath &&
      t('nach „{{moveToFolderPath}}“ verschieben', { moveToFolderPath: rule.moveToFolderPath }),
    rule.link &&
      t('{{value}} „{{value2}}“ zuordnen', {
        value: RECORD_LABELS[rule.link.entityType],
        value2: rule.link.label ?? t('gelöscht')
      })
  ].filter(Boolean)
  return `${conditions.join(t(' und '))}: ${actions.join(', ')}`
}

function MailRuleDialog({
  rule,
  open,
  onOpenChange
}: {
  /** null: a new rule */
  rule: MailRuleDto | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const utils = trpcReact.useUtils()
  const accounts = trpcReact.mail.accounts.list.useQuery()
  const status = trpcReact.mail.status.useQuery(undefined, { enabled: open })
  const [draft, setDraft] = useState<Draft>(() => draftOf(null, ''))
  const [search, setSearch] = useState('')
  // The fields start from the rule each time the dialog opens
  const [openedFor, setOpenedFor] = useState<{ open: boolean; id: number | null }>({
    open: false,
    id: null
  })
  const id = rule?.id ?? null
  if (openedFor.open !== open || openedFor.id !== id) {
    setOpenedFor({ open, id })
    if (open) {
      setDraft(draftOf(rule, accounts.data?.[0]?.id ?? ''))
      setSearch('')
    }
  }
  // The accounts may arrive after the dialog opened
  if (open && !draft.accountId && accounts.data?.[0]) {
    setDraft({ ...draft, accountId: accounts.data[0].id })
  }

  const account = accounts.data?.find((a) => a.id === draft.accountId)
  const canWrite = account !== undefined && !account.readOnly && !account.writeRefusal
  const choices = useRecordChoices(draft.linkType, search, open && draft.link)

  const folders = useQuery({
    queryKey: ['mail', draft.accountId, 'folders'],
    queryFn: () => mailApi.getFolders(draft.accountId),
    enabled: open && Boolean(draft.accountId) && status.data?.running === true
  })
  // Moving into the INBOX would be no move, and drafts are no place for incoming mail
  const targets = useMemo(
    () => flattenFolders(folders.data ?? []).filter((f) => !isInbox(f) && !isDrafts(f)),
    [folders.data]
  )
  const targetPaths = new Set(targets.map((f) => f.path))

  const save = trpcReact.mailRule.save.useMutation({
    onSuccess: () => {
      void utils.mailRule.list.invalidate()
      toast.success(t('Regel gespeichert'))
      onOpenChange(false)
    },
    onError: (error) =>
      toast.error(t('Regel konnte nicht gespeichert werden'), { description: error.message })
  })

  const writes = canWrite && (draft.markRead || draft.markFlagged || draft.moveToFolderPath)
  const linked = draft.link && draft.linkChoice !== null
  const hasCondition = Boolean(
    draft.matchFrom.trim() || draft.matchTo.trim() || draft.matchSubject.trim()
  )
  const valid = Boolean(draft.name.trim() && draft.accountId && hasCondition && (writes || linked))

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid) return
    save.mutate({
      ...(rule ? { id: rule.id } : {}),
      name: draft.name,
      accountId: draft.accountId,
      enabled: rule?.enabled ?? true,
      matchFrom: draft.matchFrom,
      matchTo: draft.matchTo,
      matchSubject: draft.matchSubject,
      // A "Nur lesen" account keeps no server action it could not carry out
      moveToFolderPath: canWrite ? draft.moveToFolderPath : null,
      markRead: canWrite && draft.markRead,
      markFlagged: canWrite && draft.markFlagged,
      link:
        draft.link && draft.linkChoice
          ? { entityType: draft.linkType, entityId: draft.linkChoice.id }
          : null
    })
  }

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="max-h-[75vh] space-y-5 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{rule ? t('Regel bearbeiten') : t('Neue Regel')}</DialogTitle>
            <DialogDescription>
              {t(
                'Die Regel gilt für E-Mails, die ab dem Speichern im Posteingang ankommen. Ältere E-Mails bleiben, wie sie sind.'
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mail-rule-name">{t('Name')}</Label>
              <Input
                id="mail-rule-name"
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder={t('z. B. Anfragen Festival')}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mail-rule-account">{t('Konto')}</Label>
              <Select
                value={draft.accountId}
                onValueChange={(value) => set({ accountId: value, moveToFolderPath: null })}
              >
                <SelectTrigger id="mail-rule-account">
                  <SelectValue placeholder={t('Konto wählen')} />
                </SelectTrigger>
                <SelectContent>
                  {(accounts.data ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <fieldset className="space-y-3">
            <legend className="font-medium">{t('Wenn')}</legend>
            <p className="text-sm text-muted-foreground">
              {t(
                'Groß- und Kleinschreibung spielt keine Rolle. Mehrere Werte trennen Sie mit Komma: einer davon genügt. Alle ausgefüllten Felder müssen passen.'
              )}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="mail-rule-from">{t('Absender enthält')}</Label>
              <Input
                id="mail-rule-from"
                value={draft.matchFrom}
                onChange={(e) => set({ matchFrom: e.target.value })}
                placeholder={t('Adresse, Domain oder Name')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mail-rule-to">{t('An/Cc enthält')}</Label>
              <Input
                id="mail-rule-to"
                value={draft.matchTo}
                onChange={(e) => set({ matchTo: e.target.value })}
                placeholder={t('z. B. eine Ihrer Adressen')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mail-rule-subject">{t('Betreff enthält')}</Label>
              <Input
                id="mail-rule-subject"
                value={draft.matchSubject}
                onChange={(e) => set({ matchSubject: e.target.value })}
              />
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="font-medium">{t('Dann')}</legend>
            {account && !canWrite && (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                {t(
                  'Dieses Konto ist auf „Nur lesen“ gestellt. Markieren und Verschieben ändern das Postfach auf dem Server, deshalb kann eine Regel hier nur zuordnen.'
                )}
              </p>
            )}
            {canWrite && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="mail-rule-folder">{t('In Ordner verschieben')}</Label>
                  <Select
                    value={draft.moveToFolderPath ?? NO_FOLDER}
                    onValueChange={(value) =>
                      set({ moveToFolderPath: value === NO_FOLDER ? null : value })
                    }
                  >
                    <SelectTrigger id="mail-rule-folder">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_FOLDER}>{t('Nicht verschieben')}</SelectItem>
                      {targets.map((folder) => (
                        <SelectItem key={folder.id} value={folder.path}>
                          {folderLabel(folder) === folder.name
                            ? folder.path
                            : `${folderLabel(folder)} (${folder.path})`}
                        </SelectItem>
                      ))}
                      {/* A stored folder the list does not show (yet), so the value stays */}
                      {draft.moveToFolderPath && !targetPaths.has(draft.moveToFolderPath) && (
                        <SelectItem value={draft.moveToFolderPath}>
                          {draft.moveToFolderPath}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  {status.data?.running !== true && (
                    <p className="text-xs text-muted-foreground">
                      {t('Die Ordner erscheinen, sobald das Postfach verbunden ist.')}
                    </p>
                  )}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={draft.markRead}
                    onChange={(e) => set({ markRead: e.target.checked })}
                  />
                  {t('Als gelesen markieren')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={draft.markFlagged}
                    onChange={(e) => set({ markFlagged: e.target.checked })}
                  />
                  {t('Mit Fähnchen markieren')}
                </label>
              </>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={draft.link}
                onChange={(e) => set({ link: e.target.checked })}
              />
              {t('Einem Datensatz zuordnen')}
            </label>
            {draft.link && (
              <div className="space-y-3 pl-6">
                <RecordPicker
                  idPrefix="mail-rule-link"
                  typeLabel={t('Zuordnen zu')}
                  type={draft.linkType}
                  onTypeChange={(next) => set({ linkType: next, linkChoice: null })}
                  search={search}
                  onSearchChange={setSearch}
                  choices={choices}
                  selected={draft.linkChoice}
                  onChoose={(choice) => set({ linkChoice: choice })}
                />
              </div>
            )}
          </fieldset>

          {!valid && draft.name.trim() && (
            <p className="text-sm text-muted-foreground">
              {hasCondition
                ? t('Bitte mindestens eine Aktion wählen.')
                : t('Bitte mindestens eine Bedingung angeben.')}
            </p>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('Abbrechen')}
            </Button>
            <Button type="submit" disabled={!valid || save.isLoading}>
              {t('Speichern')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * "E-Mail-Regeln" (Einstellungen › E-Mail), #124: what happens to new mail in the INBOX by
 * sender, recipients or subject. The rules of an account run in their order after each sync.
 */
export function MailRulesCard() {
  const utils = trpcReact.useUtils()
  const rules = trpcReact.mailRule.list.useQuery()
  const accounts = trpcReact.mail.accounts.list.useQuery()
  const [editing, setEditing] = useState<MailRuleDto | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  // The list starts folded: it can grow long, and the settings page has more below it
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')

  const refresh = () => void utils.mailRule.list.invalidate()
  const failed = (title: string) => (error: { message: string }) =>
    toast.error(title, { description: error.message })
  const remove = trpcReact.mailRule.delete.useMutation({
    onSuccess: () => {
      refresh()
      toast.success(t('Regel gelöscht'))
    },
    onError: failed(t('Regel konnte nicht gelöscht werden'))
  })
  const setEnabled = trpcReact.mailRule.setEnabled.useMutation({
    onSuccess: refresh,
    onError: failed(t('Regel konnte nicht geändert werden'))
  })
  const move = trpcReact.mailRule.move.useMutation({
    onSuccess: refresh,
    onError: failed(t('Reihenfolge konnte nicht geändert werden'))
  })

  const openDialog = (rule: MailRuleDto | null) => {
    // A new rule shows up in the list, so the list opens
    if (!rule) setExpanded(true)
    setEditing(rule)
    setDialogOpen(true)
  }

  const confirmRemove = async (rule: MailRuleDto) => {
    const confirmed = await confirmAction({
      title: t('Regel „{{name}}“ löschen?', { name: rule.name }),
      description: t('E-Mails, die sie schon verschoben oder zugeordnet hat, bleiben so.'),
      confirmLabel: t('Löschen'),
      destructive: true
    })
    if (confirmed) remove.mutate(rule.id)
  }

  const list = rules.data ?? []
  const searching = query.trim() !== ''
  const shown = filterRules(list, query, ruleSummary)
  const accountIds = [...new Set(list.map((rule) => rule.accountId))]
  const emailOf = (id: string) =>
    accounts.data?.find((a) => a.id === id)?.email ?? t('Entferntes Konto')
  const noAccount = (accounts.data ?? []).length === 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>E-Mail-Regeln</CardTitle>
        <CardDescription>
          {t(
            'Neue E-Mails im Posteingang automatisch verschieben, markieren oder einer Person, Firma, Band, einem Club oder Event zuordnen. Die Regeln eines Kontos laufen nach jedem Abruf in ihrer Reihenfolge; verschoben wird nach der ersten passenden Regel mit Ordner.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {noAccount ? t('Zuerst ein E-Mail-Konto anlegen.') : t('Noch keine Regel angelegt.')}
          </p>
        ) : (
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-medium hover:bg-muted"
            aria-expanded={expanded}
            aria-controls="mail-rules-list"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {list.length} {list.length === 1 ? t('Regel') : t('Regeln')}
            <span className="font-normal text-muted-foreground">
              · {list.filter((rule) => rule.enabled).length} eingeschaltet
            </span>
          </button>
        )}

        {list.length > 0 && expanded && (
          <div id="mail-rules-list" className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                className="pl-8"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('Regeln durchsuchen…')}
                aria-label={t('Regeln durchsuchen')}
              />
            </div>
            {shown.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t('Keine Regel passt zu „')}
                {query.trim()}“.
              </p>
            )}
            {accountIds.map((accountId) => {
              const ofAccount = list.filter((rule) => rule.accountId === accountId)
              const visible = shown.filter((rule) => rule.accountId === accountId)
              if (visible.length === 0) return null
              return (
                <section key={accountId} className="space-y-2" aria-label={emailOf(accountId)}>
                  {accountIds.length > 1 && (
                    <h3 className="text-sm font-medium">{emailOf(accountId)}</h3>
                  )}
                  <ul className="divide-y rounded-md border" aria-label="E-Mail-Regeln">
                    {visible.map((rule) => {
                      // Order is the account's whole list; while searching it is not moved
                      const index = ofAccount.indexOf(rule)
                      const moveHint = searching ? t('Zum Sortieren die Suche leeren') : undefined
                      return (
                        <li key={rule.id} className="flex items-start gap-3 px-3 py-2">
                          <Switch
                            className="mt-0.5"
                            checked={rule.enabled}
                            onCheckedChange={(enabled) =>
                              setEnabled.mutate({ id: rule.id, enabled })
                            }
                            aria-label={`${rule.name} ${rule.enabled ? 'ausschalten' : 'einschalten'}`}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{rule.name}</p>
                            <p className="text-xs text-muted-foreground">{ruleSummary(rule)}</p>
                            <p className="text-xs text-muted-foreground">
                              {rule.hitCount === 0
                                ? t('Noch nicht angewendet')
                                : t('{{hitCount}} {{value}}, zuletzt {{parseTimestamp}}', {
                                    hitCount: rule.hitCount,
                                    value: rule.hitCount === 1 ? t('E-Mail') : t('E-Mails'),
                                    parseTimestamp: parseTimestamp(
                                      rule.lastAppliedAt ?? ''
                                    ).toLocaleString(uiLocale(), {
                                      dateStyle: 'short',
                                      timeStyle: 'short'
                                    })
                                  })}
                            </p>
                            {rule.lastError && (
                              <p className="text-xs text-destructive">{rule.lastError}</p>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={searching || index === 0 || move.isLoading}
                            onClick={() => move.mutate({ id: rule.id, direction: 'up' })}
                            title={moveHint ?? t('Nach oben')}
                            aria-label={`${rule.name} nach oben`}
                          >
                            <ArrowUp />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={searching || index === ofAccount.length - 1 || move.isLoading}
                            onClick={() => move.mutate({ id: rule.id, direction: 'down' })}
                            title={moveHint ?? t('Nach unten')}
                            aria-label={`${rule.name} nach unten`}
                          >
                            <ArrowDown />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => openDialog(rule)}
                            title={t('Bearbeiten')}
                            aria-label={`${rule.name} bearbeiten`}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => void confirmRemove(rule)}
                            title={t('Löschen')}
                            aria-label={t('{{name}} löschen', { name: rule.name })}
                          >
                            <Trash2 />
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
          </div>
        )}

        <Button variant="outline" disabled={noAccount} onClick={() => openDialog(null)}>
          <Plus className="h-4 w-4" /> {t('Regel hinzufügen…')}
        </Button>

        <AliasFolders rules={list} />
      </CardContent>

      <MailRuleDialog rule={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
    </Card>
  )
}
