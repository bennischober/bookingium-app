// electron-trpc wraps a router's TRPCError as INTERNAL_SERVER_ERROR (its own bundled class
// fails the instanceof check); the formatter restores the thrown code for the renderer.
import { describe, expect, it } from 'vitest'
import { TRPCError } from '@trpc/server'
import { errorFormatter } from '../src/main/api/errorFormatter'

function wrappedShape(cause: unknown) {
  // what electron-trpc hands the formatter: its wrapper error, the original as cause
  const wrapper = Object.assign(new Error('wrapped'), { code: 'INTERNAL_SERVER_ERROR', cause })
  const shape = {
    message: wrapper.message,
    code: -32603 as const,
    data: { code: 'INTERNAL_SERVER_ERROR' as const, httpStatus: 500, path: 'band.getById' }
  }
  return errorFormatter({ shape, error: wrapper })
}

describe('errorFormatter', () => {
  it('restores the code of an error a router threw', () => {
    const shape = wrappedShape(new TRPCError({ code: 'NOT_FOUND' }))
    expect(shape.code).toBe(-32004)
    expect(shape.data).toEqual({ code: 'NOT_FOUND', httpStatus: 404, path: 'band.getById' })
  })

  it('leaves any other failure an internal error', () => {
    const shape = wrappedShape(new Error('disk full'))
    expect(shape.data.code).toBe('INTERNAL_SERVER_ERROR')
    expect(shape.data.httpStatus).toBe(500)
  })
})
