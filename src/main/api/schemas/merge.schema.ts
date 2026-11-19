import { z } from 'zod'

// #249: merging two records that turned out to be the same company, person or club/festival

export const MergeKind = z.enum(['company', 'person', 'venue'])
export type MergeKind = z.infer<typeof MergeKind>

export const MergePairInput = z.object({
  kind: MergeKind,
  /** The record that stays */
  keepId: z.number().int().positive(),
  /** The record that is merged into it and then removed */
  dropId: z.number().int().positive()
})
export type MergePairInput = z.infer<typeof MergePairInput>

export const MergeInput = MergePairInput.extend({
  /** Field keys (see MergeFieldDto.key) whose value comes from the removed record */
  take: z.array(z.string()).default([])
})
export type MergeInput = z.infer<typeof MergeInput>

/** A field both records fill differently: the user picks which value stays */
export const MergeFieldDto = z.object({
  key: z.string(),
  label: z.string(),
  keep: z.string(),
  drop: z.string()
})
export type MergeFieldDto = z.infer<typeof MergeFieldDto>

export const MergePreviewDto = z.object({
  keep: z.object({ id: z.number(), name: z.string() }),
  drop: z.object({ id: z.number(), name: z.string() }),
  /** Differing values, one choice each */
  fields: z.array(MergeFieldDto),
  /** Empty on the kept record, filled from the other one without asking */
  fills: z.array(z.object({ label: z.string(), value: z.string() })),
  /** What moves over to the kept record: "3 Events", "1 Rechnung" … */
  moves: z.array(z.object({ label: z.string(), count: z.number() }))
})
export type MergePreviewDto = z.infer<typeof MergePreviewDto>

export const MergeCandidateDto = z.object({
  id: z.number(),
  name: z.string(),
  /** Why it may be the same: "gleiche E-Mail", "gleicher Name" … */
  reason: z.string()
})
export type MergeCandidateDto = z.infer<typeof MergeCandidateDto>

export const MergeCandidatesInput = z.object({
  kind: MergeKind,
  id: z.number().int().positive()
})
export type MergeCandidatesInput = z.infer<typeof MergeCandidatesInput>
