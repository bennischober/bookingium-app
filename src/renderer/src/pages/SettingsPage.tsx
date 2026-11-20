import { useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  CalendarDays,
  DatabaseBackup,
  Download,
  FolderOpen,
  RefreshCw,
  ScrollText,
  Upload
} from 'lucide-react'
import { useExportToast } from '@/components/export/useExportToast'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { isSettingsTab, SETTINGS_TAB_LABELS, SETTINGS_TABS } from '@/components/settings/constants'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { InvoiceNumberingCard } from '@/components/invoice/InvoiceNumberingCard'
import { DatevCard } from '@/components/invoice/DatevCard'
import { CustomerNumberCard } from '@/components/invoice/CustomerNumberCard'
import { EInvoiceCard } from '@/components/invoice/EInvoiceCard'
import { PaymentQrCard } from '@/components/invoice/PaymentQrCard'
import { InvoiceEmailCard } from '@/components/invoice/InvoiceEmailCard'
import { ImportDialog } from '@/components/import/ImportDialog'
import { AppearanceCard } from '@/components/settings/AppearanceCard'
import { OwnCompanySettings } from '@/components/settings/OwnCompanySettings'
import { MailAccountsCard } from '@/components/settings/MailAccountsCard'
import { MailClientSwitchCard } from '@/components/settings/MailClientSwitchCard'
import { MailTemplatesCard } from '@/components/settings/MailTemplatesCard'
import { MailRulesCard } from '@/components/settings/MailRulesCard'
import { TipsCard } from '@/components/settings/TipsCard'
import { MapPreviewSwitchCard } from '@/components/settings/MapPreviewSwitchCard'
import { NotificationsCard } from '@/components/settings/NotificationsCard'
import { BackupCard } from '@/components/settings/BackupCard'
import { SyncCard } from '@/components/settings/SyncCard'
import { UpdatesCard } from '@/components/settings/UpdatesCard'
import { IMPORT_COUNTRY_OPTIONS } from '../../../main/api/schemas/import.schema'
import type { CalendarFeedStatusDto } from '../../../main/api/schemas/settings.schema'
import { t, uiLocale } from '../../../main/i18n/translate'

const NONE = 'none'

/** Default own company and default country */
function GeneralCard() {
  const utils = trpcReact.useUtils()
  const settings = trpcReact.settings.get.useQuery()

  const updateSettings = trpcReact.settings.update.useMutation({
    onSuccess: (saved) => {
      utils.settings.get.setData(undefined, saved)
      toast.success(t('Einstellung gespeichert'))
    },
    onError: (error) =>
      toast.error(t('Einstellung konnte nicht gespeichert werden'), { description: error.message })
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Voreinstellungen')}</CardTitle>
        <CardDescription>
          {t('Gelten für Rechnungen, Verträge, Importe und die offenen Punkte.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <OwnCompanySettings />

        <div className="space-y-2">
          <Label htmlFor="settings-country">{t('Standardland')}</Label>
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
              <SelectItem value={NONE}>{t('Keins')}</SelectItem>
              {IMPORT_COUNTRY_OPTIONS.map((country) => (
                <SelectItem key={country.code} value={country.code}>
                  {country.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t('Für importierte Einträge ohne Land (außer bei Tabellen namens „international“).')}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="settings-hotel-days">{t('Hotel spätestens (Tage vor der Show)')}</Label>
          <Input
            // Remounted with the stored value, so a refused entry springs back
            key={settings.data?.openItemsHotelDays}
            id="settings-hotel-days"
            type="number"
            min={1}
            max={365}
            className="max-w-32"
            defaultValue={settings.data?.openItemsHotelDays ?? 30}
            disabled={settings.isLoading || updateSettings.isPending}
            onBlur={(e) => {
              const days = Number(e.target.value)
              if (!Number.isInteger(days) || days < 1 || days > 365) {
                e.target.value = String(settings.data?.openItemsHotelDays ?? 30)
                return
              }
              if (days !== settings.data?.openItemsHotelDays) {
                updateSettings.mutate({ openItemsHotelDays: days })
              }
            }}
          />
          <p className="text-xs text-muted-foreground">
            {t(
              'Eine bestätigte Show, die näher liegt und noch kein Hotel hat, steht unter „Offene Punkte“ auf dem Dashboard.'
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

/** The .ics file kept up to date for calendar subscriptions */
function CalendarCard() {
  const utils = trpcReact.useUtils()
  const status = trpcReact.calendar.status.useQuery()
  const onStatus = (next: CalendarFeedStatusDto) => {
    utils.calendar.status.setData(undefined, next)
    if (next.error)
      toast.error(t('Kalender-Datei konnte nicht geschrieben werden'), { description: next.error })
  }
  const choose = trpcReact.calendar.chooseFeedFile.useMutation({
    onSuccess: (next) => {
      onStatus(next)
      if (next.path && !next.error) toast.success(t('Kalender-Datei wird jetzt aktuell gehalten'))
    }
  })
  const update = trpcReact.calendar.updateFeed.useMutation({
    onSuccess: (next) => {
      onStatus(next)
      if (!next.error) toast.success(t('Kalender-Datei aktualisiert'))
    }
  })
  const setFollowUps = trpcReact.calendar.setFeedFollowUps.useMutation({
    onSuccess: (next) => {
      onStatus(next)
      void utils.settings.get.invalidate()
      if (!next.error) toast.success(t('Einstellung gespeichert'))
    },
    onError: (error) =>
      toast.error(t('Einstellung konnte nicht gespeichert werden'), { description: error.message })
  })
  // #71: own appointments in the file, off by default
  const setAppointments = trpcReact.calendar.setFeedAppointments.useMutation({
    onSuccess: (next) => {
      onStatus(next)
      void utils.settings.get.invalidate()
      if (!next.error) toast.success(t('Einstellung gespeichert'))
    },
    onError: (error) =>
      toast.error(t('Einstellung konnte nicht gespeichert werden'), { description: error.message })
  })
  const disable = trpcReact.calendar.disableFeed.useMutation({ onSuccess: onStatus })
  const reveal = trpcReact.calendar.revealFeedFile.useMutation()
  const exportOnce = trpcReact.calendar.exportOnce.useMutation({
    onSuccess: (result) => {
      if (result.canceled) return
      const parts = [
        t('{{events}} Events', { events: result.events }),
        result.appointments > 0 &&
          t('{{appointments}} Termine', { appointments: result.appointments }),
        result.followUps > 0 && t('{{followUps}} Wiedervorlagen', { followUps: result.followUps })
      ].filter(Boolean)
      toast.success(
        t('{{lists}} exportiert', {
          lists:
            parts.length > 1
              ? t('{{first}} und {{last}}', {
                  first: parts.slice(0, -1).join(', '),
                  last: parts.at(-1)
                })
              : parts[0]
        })
      )
    },
    onError: (error) => toast.error(t('Export fehlgeschlagen'), { description: error.message })
  })

  const feed = status.data
  const active = Boolean(feed?.path)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Kalender')}</CardTitle>
        <CardDescription>
          {t(
            'Alle Events als Kalender-Datei (.ics), die Bookingium bei jeder Änderung neu schreibt.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {active && feed ? (
          <div className="space-y-1 text-sm">
            <p className="truncate font-mono text-xs" title={feed.path}>
              {feed.path}
            </p>
            <p className="text-muted-foreground">
              {feed.lastWrittenAt
                ? t('Zuletzt geschrieben {{value}} · {{events}} Events{{value2}}{{value3}}', {
                    value: new Date(feed.lastWrittenAt).toLocaleString(uiLocale()),
                    events: feed.events,
                    value2: feed.includeAppointments
                      ? ` · ${t('{{appointments}} Termine', { appointments: feed.appointments })}`
                      : '',
                    value3: feed.includeFollowUps
                      ? ` · ${t('{{followUps}} Wiedervorlagen', { followUps: feed.followUps })}`
                      : ''
                  })
                : t('Wird beim nächsten Ändern eines Events geschrieben.')}
            </p>
            {feed.error && <p className="text-destructive">{feed.error}</p>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('Aus – keine Kalender-Datei festgelegt.')}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => choose.mutate()} disabled={choose.isPending}>
            <CalendarDays className="h-4 w-4" />
            {active ? t('Andere Datei…') : t('Datei festlegen…')}
          </Button>
          {active && (
            <>
              <Button variant="outline" onClick={() => update.mutate()} disabled={update.isPending}>
                <RefreshCw className="h-4 w-4" /> {t('Jetzt aktualisieren')}
              </Button>
              <Button variant="outline" onClick={() => reveal.mutate()}>
                <FolderOpen className="h-4 w-4" /> {t('Im Ordner zeigen')}
              </Button>
              <Button variant="ghost" onClick={() => disable.mutate()}>
                {t('Ausschalten')}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            onClick={() => exportOnce.mutate()}
            disabled={exportOnce.isPending}
          >
            <Download className="h-4 w-4" /> {t('Einmalig exportieren…')}
          </Button>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Switch
              id="settings-calendar-follow-ups"
              checked={feed?.includeFollowUps ?? false}
              onCheckedChange={(checked) => setFollowUps.mutate(checked)}
              disabled={status.isLoading || setFollowUps.isPending}
            />
            <Label htmlFor="settings-calendar-follow-ups">
              {t('Offene Wiedervorlagen mit aufnehmen')}
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              'Als ganztägige Einträge am Fälligkeitstag, mit der Notiz als Text. Erledigte fallen heraus. Wer die Datei abonniert, sieht dann auch die Notizen.'
            )}
          </p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Switch
              id="settings-calendar-appointments"
              checked={feed?.includeAppointments ?? false}
              onCheckedChange={(checked) => setAppointments.mutate(checked)}
              disabled={status.isLoading || setAppointments.isPending}
            />
            <Label htmlFor="settings-calendar-appointments">
              {t('Eigene Termine mit aufnehmen')}
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              'Mit Titel, Zeit, Ort und Notizen. Wer die Datei abonniert, sieht dann auch diese Angaben; ohne den Schalter bleiben Termine nur in Bookingium.'
            )}
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          {t(
            'Abonnieren: Thunderbird kann die Datei direkt abonnieren. Outlook und Google Kalender brauchen eine Web-Adresse – z. B. die Datei in einem OneDrive- oder Dropbox-Ordner ablegen und deren direkten Download-Link abonnieren. „Einmalig exportieren“ erzeugt eine Datei zum Importieren (ohne spätere Aktualisierung).'
          )}
        </p>
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
      toast.error(t('Ordner konnte nicht geöffnet werden'), { description: error.message })
  })
  const openBackup = trpcReact.settings.openBackup.useMutation()
  const openErrorLog = trpcReact.settings.openErrorLog.useMutation({
    onError: (error) =>
      toast.error(t('Fehlerprotokoll konnte nicht geöffnet werden'), { description: error.message })
  })
  const showExport = useExportToast()
  const exportAll = trpcReact.dataExport.exportAll.useMutation({
    onSuccess: showExport,
    onError: (error) => toast.error(t('Export fehlgeschlagen'), { description: error.message })
  })
  const createBackup = trpcReact.settings.createBackup.useMutation({
    onSuccess: (result) => {
      if (result.canceled || !result.folder) return
      const folder = result.folder
      toast.success(t('Sicherung erstellt'), {
        description: folder,
        action: { label: t('Öffnen'), onClick: () => openBackup.mutate(folder) }
      })
    },
    onError: (error) => toast.error(t('Sicherung fehlgeschlagen'), { description: error.message })
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Daten')}</CardTitle>
        <CardDescription>
          {t('Listen importieren und exportieren, Daten sichern und Speicherort.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{t('Import')}</p>
            <p className="text-sm text-muted-foreground">
              {t('CSV-Listen übernehmen, etwa aus Excel; vorhandene Einträge werden nur ergänzt.')}
            </p>
          </div>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" /> {t('Daten importieren…')}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{t('Export')}</p>
            <p className="text-sm text-muted-foreground">
              {t(
                'Alle Listen als CSV-Dateien, eine Datei je Liste in einem neuen Ordner. Einzelne Listen lassen sich auf ihrer Seite exportieren.'
              )}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => exportAll.mutate()}
            disabled={exportAll.isPending}
          >
            <Download className="h-4 w-4" />
            {exportAll.isPending ? t('Wird exportiert…') : t('Alles exportieren…')}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{t('Sicherung')}</p>
            <p className="text-sm text-muted-foreground">
              {t(
                'Kopiert Datenbank und Dokumente einmalig in einen neuen Ordner. Solche Sicherungen werden nie automatisch gelöscht.'
              )}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => createBackup.mutate()}
            disabled={createBackup.isPending}
          >
            <DatabaseBackup className="h-4 w-4" />
            {createBackup.isPending ? t('Wird gesichert…') : t('Sicherung erstellen…')}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{t('Speicherort')}</p>
            <p
              className="truncate font-mono text-xs text-muted-foreground"
              title={locations.data?.dataFolder}
            >
              {locations.data?.dataFolder ?? '…'}
            </p>
          </div>
          <Button variant="outline" onClick={() => openDataFolder.mutate()}>
            <FolderOpen className="h-4 w-4" /> {t('Datenordner öffnen')}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{t('Fehlerprotokoll')}</p>
            <p className="text-sm text-muted-foreground">
              {t(
                'Unerwartete Fehler, nur auf diesem Rechner gespeichert, ohne Inhalte von E-Mails. Zum Melden eines Problems die Datei mitschicken.'
              )}
            </p>
          </div>
          <Button variant="outline" onClick={() => openErrorLog.mutate()}>
            <ScrollText className="h-4 w-4" /> {t('Fehlerprotokoll öffnen')}
          </Button>
        </div>
      </CardContent>

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </Card>
  )
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { tab?: string }
  const activeTab = isSettingsTab(search.tab) ? search.tab : 'general'

  return (
    <div className="flex w-full min-w-0 flex-col gap-8 p-6">
      <div>
        <h1 className="mb-2 text-2xl font-bold">{t('Einstellungen')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('Voreinstellungen, Darstellung, Rechnungen, E-Mail, Kalender und Datenverwaltung.')}
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(tab) =>
          // replace: switching tabs should not pile up history entries
          navigate({
            to: '/settings',
            search: { tab: isSettingsTab(tab) && tab !== 'general' ? tab : undefined },
            replace: true
          })
        }
        className="max-w-4xl"
      >
        {/* Tabs wrap onto a second row in narrow windows */}
        <TabsList className="mb-6 h-auto max-w-full flex-wrap justify-start">
          {SETTINGS_TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {SETTINGS_TAB_LABELS[tab]}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <GeneralCard />
          <AppearanceCard />
          <TipsCard />
          <MapPreviewSwitchCard />
          <NotificationsCard />
        </TabsContent>
        <TabsContent value="invoices" className="space-y-6">
          <InvoiceNumberingCard />
          <CustomerNumberCard />
          <EInvoiceCard />
          <PaymentQrCard />
          <DatevCard />
        </TabsContent>
        <TabsContent value="email" className="space-y-6">
          <InvoiceEmailCard />
          <MailClientSwitchCard />
          <MailAccountsCard />
          <MailTemplatesCard />
          <MailRulesCard />
        </TabsContent>
        <TabsContent value="calendar" className="space-y-6">
          <CalendarCard />
        </TabsContent>
        <TabsContent value="data" className="space-y-6">
          <DataCard />
          <SyncCard />
          <BackupCard />
          <UpdatesCard />
        </TabsContent>
      </Tabs>
    </div>
  )
}
