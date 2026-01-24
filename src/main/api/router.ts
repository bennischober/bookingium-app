import z from 'zod'
import { initTRPC } from '@trpc/server'
import { EventEmitter } from 'events'

const ee = new EventEmitter()

const t = initTRPC.create()

export const router = t.router({
  greeting: t.procedure.input(z.object({ name: z.string() })).query((req) => {
    const { input } = req

    ee.emit('greeting', `Greeted ${input.name}`)
    return {
      text: `Hello ${input.name}` as const
    }
  })
})

export type AppRouter = typeof router