import z from 'zod'
import { initTRPC } from '@trpc/server'
import { EventEmitter } from 'events'
import { bandRouter } from './routers/band.router'
import { companyRouter } from './routers/company.router'
import { personRouter } from './routers/person.router'
import { bankRouter } from './routers/bank.router'
import { venueRouter } from './routers/venue.router'
import { relationRouter } from './routers/relation.router'
import { dealMemoRouter } from './routers/deal_memo.router'
import { itineraryRouter } from './routers/itinerary.router'
import { hotelRouter } from './routers/hotel.router'
import { documentRouter } from './routers/document.router'
import { invoiceRouter } from './routers/invoice.router'
import { contractRouter } from './routers/contract.router'

const ee = new EventEmitter()

const t = initTRPC.create()

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
  venue: venueRouter,
  relation: relationRouter,
  dealMemo: dealMemoRouter,
  itinerary: itineraryRouter,
  hotel: hotelRouter,
  document: documentRouter,
  invoice: invoiceRouter,
  contract: contractRouter
})

export type AppRouter = typeof router
