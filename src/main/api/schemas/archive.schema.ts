import { z } from 'zod'

// ========================================
// "Booking-Archiv einlesen": many show folders at once
// ========================================
// The renderer scans a root folder, asks for a preview of each show (one call each, so it can
// show progress) and then applies the ticked ones one by one, newest first: the newest
// information fills empty fields first, an older folder never overwrites it.

export const ArchiveScanInput = z.object({
  root: z.string().min(1),
  bandId: z.number().int().positive()
})
export type ArchiveScanInput = z.infer<typeof ArchiveScanInput>

export const ArchiveShowDto = z.object({
  path: z.string(),
  folderName: z.string(),
  /** ISO, '' when neither the folder nor its file names tell */
  date: z.string(),
  endDate: z.string(),
  title: z.string(),
  /** The band's event on that date, null when one is to be created */
  eventId: z.number().nullable(),
  eventName: z.string().nullable(),
  /** That event was created by an earlier archive import (it can be corrected) */
  archiveEvent: z.boolean().default(false)
})
export type ArchiveShowDto = z.infer<typeof ArchiveShowDto>

export const ArchivePreviewInput = z.object({
  path: z.string().min(1),
  bandId: z.number().int().positive()
})
export type ArchivePreviewInput = z.infer<typeof ArchivePreviewInput>

const Named = z.object({ name: z.string(), known: z.boolean() })

export const ArchivePreviewDto = z.object({
  /** The festival or club the files name, '' when none */
  place: Named.extend({ kind: z.enum(['venue', 'festival']) }),
  /** The promoter of the contract */
  promoter: Named.nullable(),
  /** The recipient of our invoice */
  recipient: Named.nullable(),
  guaranteeCents: z.number().nullable(),
  /** The show's date from a contract, '' when none names it */
  contractDate: z.string(),
  files: z.object({
    total: z.number(),
    contracts: z.number(),
    invoices: z.number(),
    /** Travel papers, never filed */
    travel: z.number(),
    duplicates: z.number(),
    /** Without readable text (scans, old Word/Excel, images) */
    unreadable: z.number()
  })
})
export type ArchivePreviewDto = z.infer<typeof ArchivePreviewDto>

export const ArchiveApplyInput = z.object({
  path: z.string().min(1),
  bandId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte ein Datum angeben.'),
  endDate: z.string().default(''),
  /** The event's name when one is created */
  eventName: z.string().trim().min(1).max(200),
  eventId: z.number().int().positive().nullable(),
  /** File the contracts and invoices; false: only read the data */
  fileDocuments: z.boolean(),
  /**
   * Correct what an earlier archive import entered: on an event the archive import created, its
   * club, promoter and billing company are found anew when the import made them, its own values
   * are replaced, and records the import made that nothing uses any more are removed
   */
  correct: z.boolean().default(false)
})
export type ArchiveApplyInput = z.infer<typeof ArchiveApplyInput>

export const ArchiveApplyResultDto = z.object({
  eventId: z.number(),
  createdEvent: z.boolean(),
  changes: z.number(),
  documents: z.number(),
  problems: z.array(z.string()),
  /** The event was an archive event and was corrected */
  corrected: z.boolean().default(false),
  /** Clubs, festivals and companies the import had made that nothing uses any more, removed */
  removed: z.number().default(0)
})
export type ArchiveApplyResultDto = z.infer<typeof ArchiveApplyResultDto>
