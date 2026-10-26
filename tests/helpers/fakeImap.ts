// A tiny IMAP server for the one thing a unit test must not need a real mailbox for:
// which endpoint and which credentials the write path actually uses.
//
// The sandbox Dovecot gives every user name its own maildir, so the old test proved
// Dovecot's isolation - not our wiring, and it needed a live container on 127.0.0.1:10143,
// which CI does not have. This server records the LOGIN of every connection and keeps one
// message list per user, so the same claim is proven from OUR side: a write for account A
// reaches A's mailbox with A's credentials.
//
// Only the commands this client sends are implemented. Everything else answers BAD and the
// capability list names only what is really implemented: advertising UIDPLUS or MOVE while
// answering OK to them made any future move/COPYUID test pass falsely.
import net from 'net'

export type FakeImap = {
  port: number
  /** every (user, pass) that logged in, in order */
  logins: { user: string; pass: string }[]
  /** messages per user, by mailbox */
  boxes: Map<string, Map<string, Buffer[]>>
  close: () => Promise<void>
}

/** The messages one user holds in one mailbox */
export function boxOf(imap: FakeImap, user: string, mailbox: string): Buffer[] {
  return imap.boxes.get(user)?.get(mailbox) ?? []
}

/**
 * Starts a fake IMAP server on a free port.
 *
 * It accepts any credentials, records them, and keeps a separate message store per user -
 * so a write that used another account's credentials is visible as a message in the wrong box.
 */
export function startFakeImap(): Promise<FakeImap> {
  const logins: { user: string; pass: string }[] = []
  const boxes = new Map<string, Map<string, Buffer[]>>()
  const sockets = new Set<net.Socket>()

  const boxFor = (user: string, mailbox: string): Buffer[] => {
    const perUser = boxes.get(user) ?? new Map<string, Buffer[]>()
    boxes.set(user, perUser)
    const list = perUser.get(mailbox) ?? []
    perUser.set(mailbox, list)
    return list
  }

  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => undefined)
    socket.on('close', () => sockets.delete(socket))

    let buffer = ''
    let user: string | null = null
    // AUTHENTICATE PLAIN sends its payload on the following line
    let awaitingAuth: string | null = null
    // APPEND carries a literal after the command line
    let pending: { mailbox: string; size: number; rest: string } | null = null

    const send = (line: string): void => {
      socket.write(`${line}\r\n`)
    }

    send('* OK fake IMAP ready')

    socket.on('data', (chunk) => {
      buffer += chunk.toString('binary')

      // Reading an APPEND literal: the body is size bytes, then the command ends
      if (pending) {
        if (buffer.length < pending.size) return
        const body = Buffer.from(buffer.slice(0, pending.size), 'binary')
        buffer = buffer.slice(pending.size)
        boxFor(user ?? '', pending.mailbox).push(body)
        const tag = pending.rest
        pending = null
        send(`${tag} OK APPEND completed`)
        // continue with whatever else arrived in the same chunk
      }

      let index = buffer.indexOf('\r\n')
      while (index >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        index = buffer.indexOf('\r\n')
        handle(line)
        if (pending) return
      }
    })

    function handle(line: string): void {
      // the base64 of AUTHENTICATE PLAIN arrives on its own line, not as a command
      if (awaitingAuth) {
        const decoded = Buffer.from(line.trim(), 'base64').toString('utf8')
        const [, name = '', pass = ''] = decoded.split('\0')
        user = name
        logins.push({ user, pass })
        boxFor(user, 'INBOX')
        const tag = awaitingAuth
        awaitingAuth = null
        send(`${tag} OK AUTHENTICATE completed`)
        return
      }
      const [tag = '', command = '', ...rest] = line.split(' ')
      const upper = command.toUpperCase()

      if (upper === 'CAPABILITY') {
        // MR-17 follow-up: advertise ONLY what this server implements. It used to claim UIDPLUS
        // and MOVE while implementing neither, so a client that checked capabilities and then
        // moved a message got a bare OK for a command that never happened - and the test passed.
        send('* CAPABILITY IMAP4rev1 AUTH=PLAIN')
        send(`${tag} OK CAPABILITY completed`)
        return
      }
      if (upper === 'LOGIN') {
        // LOGIN "user" "pass" - quoted or bare
        const parts = rest.map((p) => p.replace(/^"|"$/g, ''))
        user = parts[0] ?? ''
        logins.push({ user, pass: parts[1] ?? '' })
        boxFor(user, 'INBOX')
        send(`${tag} OK LOGIN completed`)
        return
      }
      if (upper === 'AUTHENTICATE') {
        // imapflow sends AUTHENTICATE PLAIN on one line and the base64 of \0user\0pass as a
        // continuation, so the tag has to be remembered for the reply after it arrives
        awaitingAuth = tag
        send('+ ')
        return
      }
      if (upper === 'LIST') {
        send('* LIST (\\HasNoChildren) "/" "INBOX"')
        send(`${tag} OK LIST completed`)
        return
      }
      if (upper === 'SELECT' || upper === 'EXAMINE') {
        const mailbox = rest.map((p) => p.replace(/^"|"$/g, ''))[0] ?? 'INBOX'
        const count = boxFor(user ?? '', mailbox).length
        send('* FLAGS (\\Seen \\Deleted \\Draft)')
        send(`* ${count} EXISTS`)
        send('* OK [UIDVALIDITY 1] UIDs valid')
        send('* OK [UIDNEXT 100] Predicted next UID')
        send(`${tag} OK [READ-WRITE] ${upper} completed`)
        return
      }
      if (upper === 'STATUS') {
        // STATUS "INBOX" (MESSAGES)
        const mailbox = rest.map((p) => p.replace(/^"|"$/g, ''))[0] ?? 'INBOX'
        const count = boxFor(user ?? '', mailbox).length
        send(`* STATUS "${mailbox}" (MESSAGES ${count})`)
        send(`${tag} OK STATUS completed`)
        return
      }
      if (upper === 'APPEND') {
        // APPEND "INBOX" {size}
        const mailbox = rest.map((p) => p.replace(/^"|"$/g, ''))[0] ?? 'INBOX'
        const sizeToken = rest.find((p) => /^\{\d+\+?\}$/.test(p))
        const size = sizeToken ? Number(sizeToken.replace(/[{}]/g, '')) : 0
        if (!sizeToken) {
          send(`${tag} BAD APPEND without a literal`)
          return
        }
        pending = { mailbox, size, rest: tag }
        send('+ Ready for literal data')
        return
      }
      if (upper === 'LOGOUT') {
        send('* BYE')
        send(`${tag} OK LOGOUT completed`)
        socket.end()
        return
      }
      if (upper === 'NOOP') {
        send(`${tag} OK NOOP completed`)
        return
      }
      // Anything not implemented above is refused, not silently accepted: an OK for a command
      // this server does not perform is a lie that makes a test pass for the wrong reason.
      send(`${tag} BAD ${command} not implemented by this fake server`)
    }
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        port,
        logins,
        boxes,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy()
            server.close(() => done())
          })
      })
    })
  })
}
