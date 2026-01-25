import { z } from 'zod'
import { initTRPC } from '@trpc/server'
import { container } from 'tsyringe'
import { PersonService } from '../../services/PersonService'
import { PersonMapper } from '../mappers/person.mapper'
import { CreatePersonInput, UpdatePersonInput } from '../schemas/person.schema'
import { PaginationInput } from '../schemas/base.schema'

const t = initTRPC.create()
const personService = container.resolve(PersonService)

export const personRouter = t.router({
  getAll: t.procedure.query(async () => {
    const persons = await personService.getAllPersons()
    return PersonMapper.toDtoList(persons)
  }),

  getListItems: t.procedure.query(async () => {
    const persons = await personService.getAllPersons()
    return PersonMapper.toListItemList(persons)
  }),

  getAllPaginated: t.procedure.input(PaginationInput).query(async ({ input }) => {
    const result = await personService.getAllPersonsPaginated(input)

    return {
      ...result,
      items: PersonMapper.toDtoList(result.items)
    }
  }),

  getById: t.procedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const person = await personService.getPersonById(input.id)
    return person ? PersonMapper.toDto(person) : null
  }),

  create: t.procedure.input(CreatePersonInput).mutation(async ({ input }) => {
    const person = await personService.createPerson(input)
    return PersonMapper.toDto(person)
  }),

  update: t.procedure.input(UpdatePersonInput).mutation(async ({ input }) => {
    const person = await personService.updatePerson(input)
    return PersonMapper.toDto(person)
  }),

  delete: t.procedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await personService.deletePerson(input.id)
  })
})
