import { injectable, inject } from 'tsyringe'
import { removeOwnerFolder } from '../utils/documentStorage'
import { PersonRepository } from '../repositories/PersonRepository'
import type { CreatePersonInput, UpdatePersonInput } from '../api/schemas/person.schema'
import { PaginationInput } from '../api/schemas/base.schema'

@injectable()
export class PersonService {
  constructor(@inject(PersonRepository) private personRepository: PersonRepository) {}

  async getAllPersons() {
    return await this.personRepository.getAll()
  }

  async getAllPersonsPaginated(pagination: PaginationInput) {
    return await this.personRepository.getAllPaginated(pagination)
  }

  async getPersonById(id: number) {
    return await this.personRepository.getById(id)
  }

  async createPerson(input: CreatePersonInput) {
    return await this.personRepository.create(input)
  }

  async updatePerson(input: UpdatePersonInput) {
    return await this.personRepository.update(input)
  }

  async deletePerson(id: number) {
    await this.personRepository.delete(id)
    // Rows go with the owner (trigger); the files are removed here
    await removeOwnerFolder('person', id).catch((error) => console.error(error))
  }
}
