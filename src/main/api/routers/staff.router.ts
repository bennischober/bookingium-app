import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { z } from 'zod'
import { BrowserWindow, dialog, app } from 'electron'
import { StaffService } from '../../services/StaffService'
import { adminOnly } from '../access'
import { CreateEmployeeInput, SetStaffGrantInput, StaffGrantTarget } from '../schemas/staff.schema'

const t = initTRPC.create()
const service = container.resolve(StaffService)
// #262: employees and grants are company-internal; an employee's computer never reaches them
const adminProcedure = t.procedure.use(t.middleware(adminOnly))

const badRequest = (error: unknown) =>
  new TRPCError({
    code: 'BAD_REQUEST',
    message: error instanceof Error ? error.message : String(error)
  })

const wrap = async <T>(work: () => T | Promise<T>): Promise<T> => {
  try {
    return await work()
  } catch (error) {
    if (error instanceof TRPCError) throw error
    throw badRequest(error)
  }
}

/** #262: employees (Einstellungen › Daten) and what is shared with them (detail pages) */
export const staffRouter = t.router({
  list: adminProcedure.query(() => service.list()),

  hasEmployees: t.procedure.query(() => service.hasEmployees()),

  /** Asks for an empty folder the employee's computer will see too */
  chooseFolder: adminProcedure.mutation(async (): Promise<string | null> => {
    const owner = BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Leeren Ordner für den Mitarbeiter wählen',
      defaultPath: app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory']
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  }),

  create: adminProcedure
    .input(CreateEmployeeInput)
    .mutation(({ input }) => wrap(() => service.create(input))),

  revoke: adminProcedure
    .input(z.number())
    .mutation(({ input }) => wrap(() => service.revoke(input))),

  remove: adminProcedure
    .input(z.number())
    .mutation(({ input }) => wrap(() => service.remove(input))),

  refreshSnapshot: adminProcedure
    .input(z.number())
    .mutation(({ input }) => wrap(() => service.refreshSnapshot(input))),

  grantState: adminProcedure
    .input(StaffGrantTarget)
    .query(({ input }) => service.grantState(input)),

  setGrant: adminProcedure
    .input(SetStaffGrantInput)
    .mutation(({ input }) => wrap(() => service.setGrant(input)))
})
