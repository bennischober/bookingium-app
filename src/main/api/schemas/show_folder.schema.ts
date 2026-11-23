import { z } from 'zod'
import { DocumentType } from './document.schema'
import { ITINERARY_KEYS, SHOW_FILE_KINDS } from '../../showfolder/extract'

// "Show-Ordner einlesen": the files a booking agency puts into a folder per show (day sheet,
// venue specs, mails, plans, contract) are read, and what they say is offered for the event,
// its club, hotel and contacts. Nothing changes before the user ticks the suggestions.

export const ShowFolderAnalyzeInput = z.object({
  eventId: z.number().int().positive(),
  /** Dropped or picked files and folders; folders are read two levels deep */
  paths: z.array(z.string().min(1)).max(200).default([]),
  /**
   * "Vertrag einlesen": a document already filed (the contract at the event) is read instead
   * of paths; applying links it to the records it names
   */
  documentId: z.number().int().positive().nullable().default(null)
})
export type ShowFolderAnalyzeInput = z.infer<typeof ShowFolderAnalyzeInput>

export const ShowFileOwner = z.enum(['event', 'venue', 'none'])
export type ShowFileOwner = z.infer<typeof ShowFileOwner>

export const ShowFolderFileDto = z.object({
  path: z.string(),
  name: z.string(),
  kind: z.enum(SHOW_FILE_KINDS),
  /** Where the file is filed: the event's or the club's documents, or nowhere */
  owner: ShowFileOwner,
  documentType: DocumentType,
  /** Ticked by default */
  include: z.boolean(),
  /** Why it is not ticked, or what was found ("Scan – kein Text lesbar") */
  note: z.string()
})
export type ShowFolderFileDto = z.infer<typeof ShowFolderFileDto>

const Address = {
  street: z.string(),
  streetNumber: z.string(),
  zipCode: z.string(),
  city: z.string(),
  /** ISO code ("DE"), '' when the files do not tell */
  countryCode: z.string().default('')
}

/** One change a suggestion makes when it is ticked */
export const ShowFolderAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('itinerary'), field: z.enum(ITINERARY_KEYS), value: z.string() }),
  z.object({ type: z.literal('eventPresale'), cents: z.number().int().nonnegative() }),
  z.object({ type: z.literal('eventGuarantee'), cents: z.number().int().nonnegative() }),
  z.object({ type: z.literal('eventDeal'), text: z.string().min(1) }),
  z.object({ type: z.literal('venueCapacity'), value: z.number().int().positive() }),
  z.object({ type: z.literal('venueAddress'), ...Address }),
  z.object({ type: z.literal('venueNotes'), lines: z.array(z.string().min(1)).min(1) }),
  /** The event's club is a festival after all, or the other way round */
  z.object({ type: z.literal('venueKind'), kind: z.enum(['venue', 'festival']) }),
  z.object({
    type: z.literal('venueAssign'),
    /** An existing club or festival of that name, else one is created with the data below */
    venueId: z.number().nullable(),
    name: z.string().min(1),
    kind: z.enum(['venue', 'festival']),
    ...Address,
    capacity: z.number().int().positive().nullable(),
    notes: z.string()
  }),
  z.object({
    type: z.literal('hotel'),
    /** An existing hotel of that name, else one is created */
    hotelId: z.number().nullable(),
    name: z.string().min(1),
    ...Address,
    notes: z.string()
  }),
  z.object({
    type: z.literal('person'),
    /** The person with that e-mail, else one is created */
    personId: z.number().nullable(),
    firstName: z.string().min(1),
    lastName: z.string(),
    email: z.string(),
    phone: z.string(),
    role: z.string(),
    /** Ansprechpartner of the club */
    venueMember: z.boolean(),
    /** Kontakt vor Ort of the event */
    localContact: z.boolean(),
    /** LoPro contact of the event */
    lopro: z.boolean(),
    /** Ansprechpartner of the contract's promoter company */
    companyMember: z.boolean().default(false)
  }),
  z.object({
    type: z.literal('company'),
    /** An existing company of that name, else one is created with the data below */
    companyId: z.number().nullable(),
    name: z.string().min(1),
    ...Address,
    email: z.string(),
    phone: z.string(),
    vatId: z.string(),
    /** Entered as the event's promoter (LoPro) */
    lopro: z.boolean(),
    /** #262: entered as the event's billing company (from an invoice we wrote) */
    invoiceCompany: z.boolean().default(false),
    taxNumber: z.string().default(''),
    kskNumber: z.string().default(''),
    website: z.string().default('')
  }),
  z.object({ type: z.literal('settlement'), path: z.string().min(1) })
])
export type ShowFolderAction = z.infer<typeof ShowFolderAction>

export const SHOW_FOLDER_GROUPS = [
  'Tagesablauf',
  'Tickets & Deal',
  'Vertragspartner',
  'Club',
  'Festival',
  'Hotel',
  'Kontakte',
  'Abrechnung'
] as const
export type ShowFolderGroup = (typeof SHOW_FOLDER_GROUPS)[number]

export const ShowFolderSuggestionDto = z.object({
  id: z.string(),
  group: z.enum(SHOW_FOLDER_GROUPS),
  label: z.string(),
  /** What is stored now, '' for nothing */
  current: z.string(),
  proposed: z.string(),
  /** Ticked by default: it fills something empty. A change of a stored value starts unticked */
  include: z.boolean(),
  /** The file it comes from */
  source: z.string(),
  action: ShowFolderAction
})
export type ShowFolderSuggestionDto = z.infer<typeof ShowFolderSuggestionDto>

export const ShowFolderPlanDto = z.object({
  eventId: z.number(),
  /** The filed contract that was read ("Vertrag einlesen"), null for dropped files */
  documentId: z.number().nullable(),
  bandName: z.string(),
  /** The event's club or festival, or the one the plan offers to assign; '' for none */
  venueName: z.string(),
  venueKind: z.enum(['venue', 'festival']),
  files: z.array(ShowFolderFileDto),
  suggestions: z.array(ShowFolderSuggestionDto),
  /** Hints for the user ("Das Event hat keinen Club: …") */
  hints: z.array(z.string())
})
export type ShowFolderPlanDto = z.infer<typeof ShowFolderPlanDto>

export const ShowFolderApplyInput = z.object({
  eventId: z.number().int().positive(),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        owner: z.enum(['event', 'venue']),
        documentType: DocumentType
      })
    )
    .max(200),
  actions: z.array(ShowFolderAction).max(300),
  /** The filed contract that was read: linked to the records the ticked suggestions name */
  documentId: z.number().int().positive().nullable().default(null)
})
export type ShowFolderApplyInput = z.infer<typeof ShowFolderApplyInput>

export const ShowFolderApplyResultDto = z.object({
  documents: z.number(),
  changes: z.number(),
  /** Records the read contract was linked to */
  links: z.number().default(0),
  /** What could not be done, one line each */
  problems: z.array(z.string())
})
export type ShowFolderApplyResultDto = z.infer<typeof ShowFolderApplyResultDto>
