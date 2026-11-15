// electron-trpc wraps a router's TRPCError as INTERNAL_SERVER_ERROR (its own bundled class
// fails the instanceof check); the formatter restores the thrown code for the renderer.
import { describe, expect, it } from 'vitest'
import { TRPCError } from '@trpc/server'
import z from 'zod'
import { errorFormatter } from '../src/main/api/errorFormatter'
import { CreateBankInput } from '../src/main/api/schemas/bank.schema'
import '../src/main/api/zodLocale'

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

  it('turns a rejected input into its German messages instead of JSON', () => {
    const parsed = CreateBankInput.safeParse({
      bankName: '',
      accountHolder: '',
      iban: 'DE12',
      bic: ''
    })
    const shape = wrappedShape(new TRPCError({ code: 'BAD_REQUEST', cause: parsed.error }))
    expect(shape.data.code).toBe('BAD_REQUEST')
    expect(shape.message).toContain('Name der Bank ist erforderlich')
    expect(shape.message).toContain('Die IBAN hat mindestens 15 Zeichen')
    expect(shape.message).not.toContain('{')
  })

  it("gives zod's own messages in German", () => {
    const parsed = z.object({ count: z.number() }).safeParse({ count: 'drei' })
    const shape = wrappedShape(new TRPCError({ code: 'BAD_REQUEST', cause: parsed.error }))
    expect(shape.message).toMatch(/Ungültige Eingabe/)
  })

  it('says in German when a unique or foreign key constraint fails', () => {
    expect(wrappedShape(new Error('UNIQUE constraint failed: genres.name')).message).toBe(
      'Diesen Eintrag gibt es schon.'
    )
    expect(wrappedShape(new Error('FOREIGN KEY constraint failed')).message).toBe(
      'Der Eintrag hängt noch mit anderen Einträgen zusammen.'
    )
  })

  it('keeps a message the code wrote for people', () => {
    const thrown = new TRPCError({ code: 'BAD_REQUEST', message: 'Unbekannte Datei' })
    expect(wrappedShape(thrown).message).toBe('wrapped')
    expect(wrappedShape(new Error('Die Sicherung ist beschädigt.')).message).toBe('wrapped')
  })
})
