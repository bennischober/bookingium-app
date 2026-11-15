import { useRef } from 'react'
import { confirmDelete } from '@/lib/confirm'
import {
  deleteQuestion,
  recordErrorToast,
  recordSuccessToast,
  type RecordAction
} from '@/lib/recordCopy'
import { toast } from '@/lib/toast'

/**
 * #170: create, update and delete of one business object, wired the same way on every
 * list and detail page: one wording for the toasts (`lib/recordCopy.ts`), the delete
 * confirm dialog, and invalidation of the object's whole router (lists, pickers, detail).
 *
 * ```ts
 * const mutations = useRecordMutations({
 *   procedures: trpcReact.hotel,
 *   utils: utils.hotel,
 *   noun: 'Hotel',
 *   label: (hotel) => hotel.name,
 *   deleteInput: (hotel) => hotel.id,
 *   onSaved: sheet.close
 * })
 * <HotelForm onSubmit={mutations.submit} isSubmitting={mutations.isSubmitting} />
 * ```
 */

/** A tRPC mutation procedure, as far as this hook uses it */
interface MutationProcedure<TInput, TOutput> {
  useMutation: (options: {
    onSuccess?: (data: TOutput, variables: TInput) => unknown
    onError?: (error: { message: string }, variables: TInput) => unknown
  }) => { mutate: (input: TInput) => void; isPending: boolean }
}

interface RecordMutationOptions<TRecord, TCreate, TUpdate, TDelete> {
  /** The object's router, e.g. `trpcReact.band` */
  procedures: {
    create: MutationProcedure<TCreate, TRecord>
    update: MutationProcedure<TUpdate, TRecord>
    delete: MutationProcedure<TDelete, unknown>
  }
  /** The object's query utils, e.g. `utils.band`; all of them are invalidated after a change */
  utils: { invalidate: () => Promise<unknown> }
  /** The object in the singular, as the toasts name it: "Band", "Festival" */
  noun: string
  /** The record's name in the toasts and the delete question */
  label: (record: TRecord) => string
  /** The delete procedure's input for a record */
  deleteInput: (record: TRecord) => TDelete
  /** After a create or update (close the sheet) */
  onSaved?: (record: TRecord) => void
  /** After a delete, before the lists reload (leave the detail page) */
  onDeleted?: (record: TRecord) => unknown
}

export function useRecordMutations<TRecord, TCreate, TUpdate, TDelete>({
  procedures,
  utils,
  noun,
  label,
  deleteInput,
  onSaved,
  onDeleted
}: RecordMutationOptions<TRecord, TCreate, TUpdate, TDelete>) {
  // The record behind each running delete, for its toast (the procedure returns no name)
  const deleting = useRef(new Map<TDelete, TRecord>())

  const saved = (action: 'create' | 'update') => (record: TRecord) => {
    void utils.invalidate()
    onSaved?.(record)
    toast.success(...recordSuccessToast(action, noun, label(record)))
  }
  const failed = (action: RecordAction) => (error: { message: string }) => {
    toast.error(...recordErrorToast(action, noun, error.message))
  }

  const create = procedures.create.useMutation({
    onSuccess: saved('create'),
    onError: failed('create')
  })
  const update = procedures.update.useMutation({
    onSuccess: saved('update'),
    onError: failed('update')
  })
  const remove = procedures.delete.useMutation({
    onSuccess: async (_data, variables) => {
      const record = deleting.current.get(variables)
      deleting.current.delete(variables)
      if (record !== undefined) await onDeleted?.(record)
      void utils.invalidate()
      toast.success(...recordSuccessToast('delete', noun, record ? label(record) : noun))
    },
    onError: (error, variables) => {
      deleting.current.delete(variables)
      failed('delete')(error)
    }
  })

  /** Deletes the record without asking (the caller asked already) */
  const deleteNow = (record: TRecord) => {
    const input = deleteInput(record)
    deleting.current.set(input, record)
    remove.mutate(input)
  }

  return {
    /** The form's `onSubmit`: an update when the data carries an id, else a create */
    submit: (data: TCreate | TUpdate | (TCreate & { id?: number })) => {
      if (typeof data === 'object' && data !== null && 'id' in data && data.id != null) {
        update.mutate(data as TUpdate)
      } else {
        create.mutate(data as TCreate)
      }
    },
    isSubmitting: create.isPending || update.isPending,
    /** Asks „<label>“ löschen? and deletes on yes */
    remove: async (record: TRecord) => {
      if (await confirmDelete(deleteQuestion(label(record)))) deleteNow(record)
    },
    deleteNow,
    isDeleting: remove.isPending
  }
}
