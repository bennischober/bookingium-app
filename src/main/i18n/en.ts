// #254: English UI texts, keyed by the German source string (see translate.ts). One module
// per area under ./en/ (named after the renderer folder the texts come from); the blocks below
// hold the app shell and texts shared across areas. A German text that has no entry shows
// German. tests/i18n_guard.test.ts fails on a t('…') literal without an entry, on an entry no
// code uses any more, and on placeholders that differ between key and translation.

import { agencyEn } from './en/agencyEn'
import { appointmentsEn } from './en/appointmentsEn'
import { bandEn } from './en/bandEn'
import { agreementEn } from './en/agreementEn'
import { companyEn } from './en/companyEn'
import { contactListEn } from './en/contactListEn'
import { dataTableEn } from './en/dataTableEn'
import { detailEn } from './en/detailEn'
import { documentsEn } from './en/documentsEn'
import { errorFallbackEn } from './en/errorFallbackEn'
import { eventHubEn } from './en/eventHubEn'
import { eventListEn } from './en/eventListEn'
import { eventWizardEn } from './en/eventWizardEn'
import { exportEn } from './en/exportEn'
import { followUpsEn } from './en/followUpsEn'
import { formSheetEn } from './en/formSheetEn'
import { formsEn } from './en/formsEn'
import { fragmentsEn } from './en/fragmentsEn'
import { hooksEn } from './en/hooksEn'
import { importEn } from './en/importEn'
import { infoLabelEn } from './en/infoLabelEn'
import { insertTemplateEn } from './en/insertTemplateEn'
import { invoiceEn } from './en/invoiceEn'
import { labelsEn } from './en/labelsEn'
import { layoutEn } from './en/layoutEn'
import { libEn } from './en/libEn'
import { mailEn } from './en/mailEn'
import { mapEn } from './en/mapEn'
import { membersSheetEn } from './en/membersSheetEn'
import { openItemsEn } from './en/openItemsEn'
import { pagesEn } from './en/pagesEn'
import { personEn } from './en/personEn'
import { printEn } from './en/printEn'
import { quickCreateEn } from './en/quickCreateEn'
import { receiptsEn } from './en/receiptsEn'
import { showFolderEn } from './en/showFolderEn'
import { settingsEn } from './en/settingsEn'
import { settlementEn } from './en/settlementEn'
import { staffEn } from './en/staffEn'
import { shortcutsHelpEn } from './en/shortcutsHelpEn'
import { taxCodesEn } from './en/taxCodesEn'
import { tipEn } from './en/tipEn'
import { tourEn } from './en/tourEn'
import { tourImportEn } from './en/tourImportEn'
import { tripsEn } from './en/tripsEn'
import { uiEn } from './en/uiEn'
import { valuesEn } from './en/valuesEn'
import { whatsNewHostEn } from './en/whatsNewHostEn'
const SHELL: Record<string, string> = {
  // Menu groups and pages (ROUTES)
  Planung: 'Planning',
  Finanzen: 'Finance',
  Kontakte: 'Contacts',
  Kommunikation: 'Communication',
  Verwaltung: 'Administration',
  Dashboard: 'Dashboard',
  Kalender: 'Calendar',
  Touren: 'Tours',
  Karte: 'Map',
  Belege: 'Receipts',
  Reisekosten: 'Travel expenses',
  'E-Mail': 'Email',
  Einstellungen: 'Settings',
  // Sidebar
  Hauptnavigation: 'Main navigation',
  'Zum Dashboard': 'Go to dashboard',
  '{{count}} Wiedervorlage fällig': '{{count}} follow-up due',
  '{{count}} Wiedervorlagen fällig': '{{count}} follow-ups due',
  'Wiedervorlagen fällig': 'follow-ups due',
  'ungelesen im Posteingang': 'unread in inbox'
}

// Shared building blocks: list tables, load states, confirm dialog
const COMMON: Record<string, string> = {
  'Wird geladen…': 'Loading…',
  'Weitere werden geladen…': 'Loading more…',
  'Nicht geladen': 'Not loaded',
  '{{count}} {{noun}}': '{{count}} {{noun}}',
  '{{count}} {{noun}} gefunden': '{{count}} {{noun}} found',
  '{{count}} {{noun}} ausgewählt': '{{count}} {{noun}} selected',
  '{{count}} geladen – weitere beim Scrollen': '{{count}} loaded – more as you scroll',
  'Konnte nicht geladen werden': 'Could not be loaded',
  'Erneut versuchen': 'Try again',
  // date-fns pattern for a short date
  'dd.MM.yyyy': 'dd/MM/yyyy',
  // Fragments inside other texts
  ', zuletzt synchronisiert {{when}}': ', last synchronised {{when}}',
  'seit {{date}} ': 'since {{date}} ',
  ' seit {{date}}': ' since {{date}}',
  ' an {{to}}': ' to {{to}}',
  '{{amount}} netto': '{{amount}} net',
  'Den Steuerschlüssel ändern Sie je Position unter „Bearbeiten“.':
    'You change the tax code per line item under “Edit”.',
  'Eine gestellte Rechnung ändern Sie per Storno und neuer Rechnung.':
    'An issued invoice is changed by cancelling it and creating a new one.',
  '1 Mal': 'once',
  '{{count}} Mal': '{{count}} times',
  Abbrechen: 'Cancel',
  Bestätigen: 'Confirm'
}

const SETTINGS: Record<string, string> = {
  Darstellung: 'Appearance',
  'Gilt nur auf diesem Computer.': 'Applies to this computer only.',
  Farbschema: 'Colour scheme',
  Hell: 'Light',
  Dunkel: 'Dark',
  'Wie das System': 'Same as system',
  'Sprache der Oberfläche': 'Interface language',
  'Dokumente für Dritte (Verträge, Rechnungen, E-Mails) behalten ihre eigene Sprache.':
    'Documents for third parties (contracts, invoices, emails) keep their own language.',
  'Die Sprache konnte nicht gespeichert werden.': 'The language could not be saved.'
}

export const EN: Readonly<Record<string, string>> = {
  ...SHELL,
  ...COMMON,
  ...SETTINGS,
  ...agencyEn,
  ...appointmentsEn,
  ...bandEn,
  ...agreementEn,
  ...companyEn,
  ...contactListEn,
  ...dataTableEn,
  ...detailEn,
  ...documentsEn,
  ...errorFallbackEn,
  ...eventHubEn,
  ...eventListEn,
  ...eventWizardEn,
  ...exportEn,
  ...followUpsEn,
  ...formSheetEn,
  ...formsEn,
  ...fragmentsEn,
  ...hooksEn,
  ...importEn,
  ...infoLabelEn,
  ...insertTemplateEn,
  ...invoiceEn,
  ...labelsEn,
  ...layoutEn,
  ...libEn,
  ...mailEn,
  ...mapEn,
  ...membersSheetEn,
  ...openItemsEn,
  ...pagesEn,
  ...personEn,
  ...printEn,
  ...quickCreateEn,
  ...receiptsEn,
  ...showFolderEn,
  ...settingsEn,
  ...settlementEn,
  ...staffEn,
  ...shortcutsHelpEn,
  ...taxCodesEn,
  ...tipEn,
  ...tourEn,
  ...tourImportEn,
  ...tripsEn,
  ...uiEn,
  ...valuesEn,
  ...whatsNewHostEn
}
