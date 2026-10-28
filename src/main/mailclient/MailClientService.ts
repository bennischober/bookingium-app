// Runs the mail core in a utility process (mailWorker.js) and relays calls,
// events and credential requests. The worker starts on the first call or at
// app start when accounts exist, and restarts after account changes. A worker
// that keeps crashing is not restarted until the accounts change again.
import { utilityProcess, type UtilityProcess } from 'electron'
import { EventEmitter } from 'events'
import { join } from 'path'
import { listMailAccounts, mailCredentials, mailRoot } from './accounts'
import type { FromWorker, MailApiMethod, MailEvent, ToWorker, WorkerInit } from './protocol'
import { logError } from '../utils/errorLog'

// The local Dovecot/Mailpit sandbox; its SMTP sink listens here
const CRASH_WINDOW_MS = 60_000
const MAX_CRASHES = 3

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

export class MailClientService {
  /** 'event' (MailEvent) and 'status' (worker state changes) */
  readonly events = new EventEmitter()

  private worker: UtilityProcess | null = null
  private starting: Promise<void> | null = null
  private stopping = false
  private nextId = 1
  private pending = new Map<number, Pending>()
  private crashes: number[] = []
  private lastError: string | null = null
  /** whileStopped() calls in progress */
  private held = 0

  /** starting: the worker opens its stores, which takes minutes while a migration rewrites a large one */
  status(): { running: boolean; starting: boolean; error: string | null } {
    return {
      running: this.worker !== null && this.starting === null,
      starting: this.starting !== null,
      error: this.lastError
    }
  }

  async call(method: MailApiMethod, args: unknown[]): Promise<unknown> {
    await this.ensureStarted()
    const worker = this.worker
    if (!worker) throw new Error(this.lastError ?? 'Mail-Client ist nicht gestartet')
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.post(worker, { type: 'call', id, method, args })
    })
  }

  /** Starts the worker if accounts exist; errors are kept for status() */
  startIfConfigured(): void {
    if (listMailAccounts().length === 0) return
    this.ensureStarted().catch(() => {})
  }

  /** After account changes: stop the worker and start it with the new configuration */
  async restart(): Promise<void> {
    await this.stop()
    this.crashes = []
    this.lastError = null
    this.startIfConfigured()
  }

  /**
   * Runs `fn` with the worker stopped and kept stopped (calls fail meanwhile), then starts it
   * with the current accounts. For connection tests: a live server allows two connections,
   * and the worker may already hold both.
   */
  async whileStopped<T>(fn: () => Promise<T>): Promise<T> {
    this.held++
    try {
      await this.stop()
      return await fn()
    } finally {
      this.held--
      if (this.held === 0) {
        this.crashes = []
        this.lastError = null
        this.startIfConfigured()
      }
    }
  }

  /**
   * Closes the worker, killing it after `timeoutMs`. A worker that is still starting counts
   * against the same deadline: it answers nothing until its stores are open, and a migration
   * killed half-way is rolled back by SQLite and runs again on the next start.
   */
  async stop(timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    if (this.starting) {
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        this.starting.catch(() => {}),
        new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)))
      ])
      clearTimeout(timer)
    }
    const worker = this.worker
    if (!worker) return
    this.stopping = true
    try {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(
          () => {
            worker.kill()
            resolve()
          },
          Math.max(0, deadline - Date.now())
        )
        worker.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
        this.post(worker, { type: 'close' })
      })
    } finally {
      this.stopping = false
    }
  }

  private ensureStarted(): Promise<void> {
    if (this.held > 0)
      return Promise.reject(new Error('Mail-Client pausiert für den Verbindungstest'))
    if (this.worker && !this.starting) return Promise.resolve()
    if (!this.starting) {
      this.starting = this.spawn().finally(() => {
        this.starting = null
        this.events.emit('status', this.status())
      })
    }
    return this.starting
  }

  private spawn(): Promise<void> {
    const recent = this.crashes.filter((t) => Date.now() - t < CRASH_WINDOW_MS)
    if (recent.length >= MAX_CRASHES) {
      return Promise.reject(new Error(this.lastError ?? 'Mail-Client stürzt wiederholt ab'))
    }
    const init = this.workerInit()

    return new Promise<void>((resolve, reject) => {
      const worker = utilityProcess.fork(join(__dirname, 'mailWorker.js'), [], {
        serviceName: 'Bookingum Mail'
      })
      this.worker = worker
      let settled = false
      const fail = (message: string): void => {
        this.lastError = message
        if (!settled) {
          settled = true
          reject(new Error(message))
        }
      }

      worker.on('message', (msg: FromWorker) => {
        switch (msg.type) {
          case 'ready':
            this.lastError = null
            settled = true
            resolve()
            break
          case 'init-error':
            fail(msg.message)
            worker.kill()
            break
          case 'result': {
            const p = this.pending.get(msg.id)
            this.pending.delete(msg.id)
            if (msg.error !== undefined) p?.reject(new Error(msg.error))
            else p?.resolve(msg.value)
            break
          }
          case 'credentials-request':
            this.answerCredentials(worker, msg.reqId, msg.accountId)
            break
          case 'event':
            this.events.emit('event', msg.event satisfies MailEvent)
            break
          case 'log':
            console[msg.level](`[mail] ${msg.message}`)
            // the core's log.error is kept for real failures; the expected ones arrive as events
            if (msg.level === 'error') {
              logError('mail-core', { message: msg.message, stack: msg.stack })
            }
            break
        }
      })

      worker.on('exit', (code) => {
        if (this.worker === worker) this.worker = null
        for (const p of this.pending.values()) p.reject(new Error('Mail-Client wurde beendet'))
        this.pending.clear()
        if (!this.stopping && code !== 0) {
          this.crashes.push(Date.now())
          console.error(`[mail] worker exited with code ${code}`)
          logError('mail-worker', `mail worker exited with code ${code}`, { fatal: true })
          fail(this.lastError ?? `Mail-Client abgestürzt (Code ${code})`)
        } else if (!settled) {
          fail(this.lastError ?? 'Mail-Client wurde beendet')
        }
        this.events.emit('status', this.status())
      })

      this.post(worker, { type: 'init', init })
    })
  }

  private workerInit(): WorkerInit {
    const accounts = listMailAccounts()
    if (accounts.length === 0) throw new Error('Kein E-Mail-Konto eingerichtet')
    return {
      dataDir: join(mailRoot(), 'data'),
      // A7: each account carries its OWN write endpoint; the core's guard decides per account
      // ("Nur lesen", and no login in the clear off loopback)
      accounts: accounts.map((account) => ({
        id: account.id,
        readOnly: account.readOnly,
        host: account.host,
        port: account.port,
        security: account.security,
        email: account.email,
        smtpHost: account.smtpHost,
        smtpPort: account.smtpPort,
        smtpSecurity: account.smtpSecurity
      }))
    }
  }

  private answerCredentials(worker: UtilityProcess, reqId: number, accountId: string): void {
    try {
      this.post(worker, { type: 'credentials', reqId, ...mailCredentials(accountId) })
    } catch (error) {
      this.post(worker, {
        type: 'credentials',
        reqId,
        error: error instanceof Error ? error.message : 'Zugangsdaten nicht lesbar'
      })
    }
  }

  private post(worker: UtilityProcess, msg: ToWorker): void {
    worker.postMessage(msg)
  }
}

export const mailClient = new MailClientService()
