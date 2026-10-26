// A scriptable IMAP server for sync-engine tests that need more than a greeting: several
// folders (which may share UIDs, the case MR-09 is about), SELECT vs EXAMINE, UIDVALIDITY,
// UIDNEXT, UID FETCH of flags and sources, and a STATUS that can be made to fail.
//
// It speaks only the subset imapflow uses against a plain IMAP4rev1 server (no CONDSTORE,
// no IDLE), and records the mailbox commands so a test can assert which folder a FETCH
// really went to.
import net from 'net'

export type FakeMessage = { uid: number; flags?: string[]; source?: string }

export type FakeFolder = {
  uidValidity: number
  uidNext: number
  messages: FakeMessage[]
}

export type ScriptedImap = {
  port: number
  folders: Map<string, FakeFolder>
  /** "SELECT A", "EXAMINE A", "STATUS A", "FETCH A" (the folder selected when it ran) */
  log: string[]
  /** connections accepted so far */
  connections: () => number
  /** answer every STATUS with NO */
  failStatus: boolean
  close: () => Promise<void>
}

const quote = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** The mailbox argument at the start of `rest`: quoted or atom */
function mailboxArg(rest: string): string {
  const m = rest.match(/^"((?:[^"\\]|\\.)*)"|^(\S+)/)
  if (!m) return ''
  return m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]
}

/** UIDs of `messages` inside an IMAP sequence set like "1:5,7,9:*" */
function inSet(set: string, uid: number): boolean {
  return set.split(',').some((part) => {
    const [a, b] = part.split(':')
    const lo = a === '*' ? Infinity : Number(a)
    if (b === undefined) return a === '*' || uid === lo
    const hi = b === '*' ? Infinity : Number(b)
    return uid >= Math.min(lo, hi) && uid <= Math.max(lo, hi)
  })
}

export async function scriptedImap(folders: Record<string, FakeFolder>): Promise<ScriptedImap> {
  const sockets = new Set<net.Socket>()
  let accepted = 0
  const state: ScriptedImap = {
    port: 0,
    folders: new Map(Object.entries(folders)),
    log: [],
    connections: () => accepted,
    failStatus: false,
    close: async () => undefined
  }

  const server = net.createServer((socket) => {
    accepted++
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.write('* OK [CAPABILITY IMAP4rev1] fake server ready\r\n')
    let selected: string | null = null
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let end: number
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const space = line.indexOf(' ')
        const tag = line.slice(0, space)
        let rest = line.slice(space + 1)
        let command = rest.split(' ')[0].toUpperCase()
        rest = rest.slice(command.length + 1)
        if (command === 'UID') {
          command = `UID ${rest.split(' ')[0].toUpperCase()}`
          rest = rest.slice(rest.indexOf(' ') + 1)
        }
        const write = (s: string): void => {
          socket.write(s)
        }
        if (command === 'CAPABILITY') {
          write(`* CAPABILITY IMAP4rev1\r\n${tag} OK done\r\n`)
        } else if (command === 'LOGIN') {
          write(`${tag} OK [CAPABILITY IMAP4rev1] logged in\r\n`)
        } else if (command === 'LIST' || command === 'LSUB') {
          let out = ''
          // LIST "" "" asks for the hierarchy delimiter only (RFC 3501 6.3.8)
          if (/""\s*""\s*$/.test(rest)) out = `* ${command} (\\Noselect) "/" ""\r\n`
          else
            for (const path of state.folders.keys())
              out += `* ${command} (\\HasNoChildren) "/" ${quote(path)}\r\n`
          write(`${out}${tag} OK done\r\n`)
        } else if (command === 'SELECT' || command === 'EXAMINE') {
          const path = mailboxArg(rest)
          const folder = state.folders.get(path)
          state.log.push(`${command} ${path}`)
          if (!folder) {
            selected = null
            write(`${tag} NO no such mailbox\r\n`)
            continue
          }
          selected = path
          write(
            `* FLAGS (\\Seen \\Flagged \\Answered \\Draft \\Deleted)\r\n` +
              `* ${folder.messages.length} EXISTS\r\n` +
              `* OK [UIDVALIDITY ${folder.uidValidity}] ok\r\n` +
              `* OK [UIDNEXT ${folder.uidNext}] ok\r\n` +
              `${tag} OK [${command === 'EXAMINE' ? 'READ-ONLY' : 'READ-WRITE'}] done\r\n`
          )
        } else if (command === 'STATUS') {
          const path = mailboxArg(rest)
          const folder = state.folders.get(path)
          state.log.push(`STATUS ${path}`)
          if (state.failStatus || !folder) {
            write(`${tag} NO status refused\r\n`)
            continue
          }
          write(
            `* STATUS ${quote(path)} (MESSAGES ${folder.messages.length} UIDNEXT ${folder.uidNext} UIDVALIDITY ${folder.uidValidity})\r\n${tag} OK done\r\n`
          )
        } else if (command === 'UID FETCH' || command === 'FETCH') {
          const folder = selected ? state.folders.get(selected) : undefined
          state.log.push(`FETCH ${selected ?? '-'}`)
          if (!folder) {
            write(`${tag} BAD no mailbox selected\r\n`)
            continue
          }
          const set = rest.split(' ')[0]
          const items = rest.toUpperCase()
          const maxUid = Math.max(0, ...folder.messages.map((m) => m.uid))
          folder.messages.forEach((m, index) => {
            // "n:*" always includes the highest UID (RFC 3501 6.4.8)
            if (!inSet(set, m.uid) && !(set.endsWith('*') && m.uid === maxUid)) return
            const parts = [`UID ${m.uid}`]
            if (items.includes('FLAGS')) parts.push(`FLAGS (${(m.flags ?? []).join(' ')})`)
            if (items.includes('INTERNALDATE'))
              parts.push('INTERNALDATE "01-Jan-2026 09:00:00 +0000"')
            if (items.includes('RFC822.SIZE'))
              parts.push(`RFC822.SIZE ${Buffer.byteLength(m.source ?? '')}`)
            if (items.includes('BODY.PEEK[]') || items.includes('BODY[]')) {
              const source = m.source ?? ''
              parts.push(`BODY[] {${Buffer.byteLength(source)}}\r\n${source}`)
            }
            write(`* ${index + 1} FETCH (${parts.join(' ')})\r\n`)
          })
          write(`${tag} OK done\r\n`)
        } else if (command === 'LOGOUT') {
          socket.end(`* BYE logging out\r\n${tag} OK done\r\n`)
        } else {
          write(`${tag} OK done\r\n`)
        }
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  state.port = (server.address() as net.AddressInfo).port
  state.close = () =>
    new Promise((resolve) => {
      for (const s of sockets) s.destroy()
      server.close(() => resolve())
    })
  return state
}
