import { initTRPC } from '@trpc/server'
import { z } from 'zod'
import { container } from 'tsyringe'
import { DashboardService } from '../../services/DashboardService'

const t = initTRPC.create()
const dashboardService = container.resolve(DashboardService)

export const DashboardStatsDto = z.object({
  upcomingNext7Days: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      date: z.string(),
      status: z.string(),
      bandName: z.string(),
      venueName: z.string().nullable()
    })
  ),
  pendingEventsCount: z.number(),
  eventsThisMonthCount: z.number(),
  openInvoicesCount: z.number(),
  overdueInvoicesCount: z.number(),
  openInvoiceAmount: z.number(),
  directory: z.object({
    bands: z.number(),
    venues: z.number(),
    companies: z.number(),
    persons: z.number()
  })
})

export type DashboardStatsDto = z.infer<typeof DashboardStatsDto>

export const dashboardRouter = t.router({
  getStats: t.procedure.query(async () => dashboardService.getStats())
})
