import z from 'zod'
import { initTRPC } from '@trpc/server'
import { errorFormatter } from './errorFormatter'
import './zodLocale'
import { EventEmitter } from 'events'
import { bandRouter } from './routers/band.router'
import { companyRouter } from './routers/company.router'
import { personRouter } from './routers/person.router'
import { bankRouter } from './routers/bank.router'
import { genreRouter } from './routers/genre.router'
import { datevRouter } from './routers/datev.router'
import { venueRouter } from './routers/venue.router'
import { relationRouter } from './routers/relation.router'
import { dealMemoRouter } from './routers/deal_memo.router'
import { itineraryRouter } from './routers/itinerary.router'
import { hotelRouter } from './routers/hotel.router'
import { documentRouter } from './routers/document.router'
import { invoiceRouter } from './routers/invoice.router'
import { contractRouter } from './routers/contract.router'
import { searchRouter } from './routers/search.router'
import { dashboardRouter } from './routers/dashboard.router'
import { managementContractRouter } from './routers/management_contract.router'
import { bandAgreementRouter } from './routers/band_agreement.router'
import { importRouter } from './routers/import.router'
import { settingsRouter } from './routers/settings.router'
import { mergeRouter } from './routers/merge.router'
import { marketingRouter } from './routers/marketing.router'
import { backupRouter } from './routers/backup.router'
import { syncRouter } from './routers/sync.router'
import { updatesRouter } from './routers/updates.router'
import { exportRouter } from './routers/export.router'
import { calendarRouter } from './routers/calendar.router'
import { contactListRouter } from './routers/contact_list.router'
import { followUpRouter } from './routers/follow_up.router'
import { appointmentRouter } from './routers/appointment.router'
import { externalBookingRouter } from './routers/external_booking.router'
import { tourImportRouter } from './routers/tour_import.router'
import { mailRouter } from './routers/mail.router'
import { mailLinkRouter } from './routers/mail_link.router'
import { mailRuleRouter } from './routers/mail_rule.router'
import { mailTemplateRouter } from './routers/mail_template.router'
import { mapRouter } from './routers/map.router'
import { settlementRouter } from './routers/settlement.router'
import { showFolderRouter } from './routers/show_folder.router'
import { advancingRouter } from './routers/advancing.router'
import { eventStepRouter } from './routers/event_step.router'
import { companyEnrichmentRouter } from './routers/company_enrichment.router'
import { einvoicePartyRouter } from './routers/einvoice_party.router'
import { receiptRouter } from './routers/receipt.router'
import { tripRouter } from './routers/trip.router'
import { accessRouter } from './routers/access.router'
import { staffRouter } from './routers/staff.router'
import { archiveRouter } from './routers/archive.router'
import { releaseRouter } from './routers/release.router'

const ee = new EventEmitter()

const t = initTRPC.create({ errorFormatter })

export const router = t.router({
  greeting: t.procedure.input(z.object({ name: z.string() })).query((req) => {
    const { input } = req

    ee.emit('greeting', `Greeted ${input.name}`)
    return {
      text: `Hello ${input.name}` as const
    }
  }),
  band: bandRouter,
  company: companyRouter,
  person: personRouter,
  bank: bankRouter,
  genre: genreRouter,
  datev: datevRouter,
  venue: venueRouter,
  relation: relationRouter,
  dealMemo: dealMemoRouter,
  itinerary: itineraryRouter,
  hotel: hotelRouter,
  release: releaseRouter,
  document: documentRouter,
  invoice: invoiceRouter,
  contract: contractRouter,
  search: searchRouter,
  dashboard: dashboardRouter,
  managementContract: managementContractRouter,
  bandAgreement: bandAgreementRouter,
  dataImport: importRouter,
  settings: settingsRouter,
  merge: mergeRouter,
  marketing: marketingRouter,
  backup: backupRouter,
  sync: syncRouter,
  updates: updatesRouter,
  dataExport: exportRouter,
  calendar: calendarRouter,
  contactList: contactListRouter,
  followUp: followUpRouter,
  appointment: appointmentRouter,
  externalBooking: externalBookingRouter,
  tourImport: tourImportRouter,
  mail: mailRouter,
  mailLink: mailLinkRouter,
  mailRule: mailRuleRouter,
  mailTemplate: mailTemplateRouter,
  map: mapRouter,
  settlement: settlementRouter,
  showFolder: showFolderRouter,
  advancing: advancingRouter,
  eventStep: eventStepRouter,
  companyEnrichment: companyEnrichmentRouter,
  einvoiceParty: einvoicePartyRouter,
  receipt: receiptRouter,
  trip: tripRouter,
  access: accessRouter,
  staff: staffRouter,
  archive: archiveRouter
})

export type AppRouter = typeof router
