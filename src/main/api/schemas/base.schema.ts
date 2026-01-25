import z from 'zod'

export const TimestampFields = z.object({
  createdAt: z.string(),
  updatedAt: z.string()
})
export type TimestampFields = z.infer<typeof TimestampFields>
