import type { db } from '../db'

/** The handle inside a synchronous `db.transaction((tx) => ...)` callback */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Anything that can run a select: `db` itself or a transaction's `tx` */
export type Reader = Pick<Tx, 'select'>
