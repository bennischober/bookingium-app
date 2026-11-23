import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { AccessError, AccessService } from '../../services/AccessService'
import {
  EnableStaffAccessInput,
  SetStaffPinInput,
  UnlockStaffAccessInput,
  type AccessStatusDto
} from '../schemas/access.schema'

const t = initTRPC.create()
const service = container.resolve(AccessService)

function run(action: () => AccessStatusDto): AccessStatusDto {
  try {
    return action()
  } catch (error) {
    if (error instanceof AccessError)
      throw new TRPCError({ code: 'FORBIDDEN', message: error.message })
    throw error
  }
}

/** #262: staff access (Mitarbeiterzugang) of this computer, Einstellungen › Allgemein */
export const accessRouter = t.router({
  status: t.procedure.query((): AccessStatusDto => service.status()),

  enable: t.procedure
    .input(EnableStaffAccessInput)
    .mutation(({ input }) => run(() => service.enable(input.pin))),

  disable: t.procedure.mutation(() => run(() => service.disable())),

  setPin: t.procedure
    .input(SetStaffPinInput)
    .mutation(({ input }) => run(() => service.setPin(input.pin))),

  unlock: t.procedure
    .input(UnlockStaffAccessInput)
    .mutation(({ input }) => run(() => service.unlock(input.pin))),

  lock: t.procedure.mutation(() => run(() => service.lock()))
})
