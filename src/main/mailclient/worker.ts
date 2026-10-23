// Mail worker: runs in an Electron utility process and hosts the mail core,
// so SQLite (synchronous), sync and indexing never block the main process.
// It never sees stored passwords; it asks the main process for credentials
// per connection (main decrypts them with safeStorage).
import { createMailCore, type MailCore } from './core/index'
import { MAIL_API_METHODS, type FromWorker, type ToWorker, type WorkerInit } from './protocol'

const port = process.parentPort
let core: MailCore | null = null
let nextReqId = 1
const credentialRequests = new Map<
  number,
  { resolve: (c: { user: string; pass: string }) => void; reject: (e: Error) => void }
>()

function send(msg: FromWorker): void {
  port.postMessage(msg)
}

function requestCredentials(accountId: string): Promise<{ user: string; pass: string }> {
  const reqId = nextReqId++
  return new Promise((resolve, reject) => {
    credentialRequests.set(reqId, { resolve, reject })
    send({ type: 'credentials-request', reqId, accountId })
  })
}

function init(options: WorkerInit): void {
  core = createMailCore({
    dataDir: options.dataDir,
    accounts: options.accounts.map((a) => ({
      ...a,
      credentials: () => requestCredentials(a.id)
    })),
    sandbox: options.sandbox,
    log: {
      info: (message) => send({ type: 'log', level: 'info', message }),
      warn: (message) => send({ type: 'log', level: 'warn', message }),
      error: (message) => send({ type: 'log', level: 'error', message })
    }
  })
  core.on('sync-event', (event) => send({ type: 'event', event }))
  core.start()
}

async function call(id: number, method: string, args: unknown[]): Promise<void> {
  try {
    if (!core) throw new Error('Mail-Client ist nicht gestartet')
    if (!(MAIL_API_METHODS as readonly string[]).includes(method)) {
      throw new Error(`Unbekannte Methode: ${method}`)
    }
    const fn = (core as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]
    send({ type: 'result', id, value: await fn.apply(core, args) })
  } catch (error) {
    send({ type: 'result', id, error: error instanceof Error ? error.message : String(error) })
  }
}

port.on('message', (e) => {
  const msg = e.data as ToWorker
  switch (msg.type) {
    case 'init':
      try {
        init(msg.init)
        send({ type: 'ready' })
      } catch (error) {
        send({
          type: 'init-error',
          message: error instanceof Error ? error.message : String(error)
        })
      }
      break
    case 'call':
      void call(msg.id, msg.method, msg.args)
      break
    case 'credentials': {
      const waiter = credentialRequests.get(msg.reqId)
      credentialRequests.delete(msg.reqId)
      if (!waiter) break
      if (msg.error || msg.user === undefined || msg.pass === undefined) {
        waiter.reject(new Error(msg.error ?? 'Keine Zugangsdaten'))
      } else {
        waiter.resolve({ user: msg.user, pass: msg.pass })
      }
      break
    }
    case 'close':
      void (async () => {
        try {
          await core?.close()
        } finally {
          core = null
          send({ type: 'closed' })
          process.exit(0)
        }
      })()
      break
  }
})
