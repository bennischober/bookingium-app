// A tiny SMTP server that REQUIRES AUTH, for the one thing the sandbox cannot prove:
// Mailpit accepts unauthenticated mail, so every send test passes even when the client
// sends no credentials at all. This server refuses MAIL FROM until a correct AUTH arrived.
import net from 'net'

export type FakeSmtp = {
  port: number
  /** the raw DATA payload of every accepted message */
  messages: string[]
  /** every AUTH the client attempted, decoded */
  authAttempts: { user: string; pass: string }[]
  /** every command the client sent, for protocol assertions */
  commands: string[]
  close: () => Promise<void>
}

/**
 * Starts a fake SMTP server on a free port.
 *
 * It advertises AUTH PLAIN and LOGIN, refuses `MAIL FROM`/`DATA` with 530 until a
 * correct AUTH arrived, and answers 535 for wrong credentials.
 */
export function startFakeSmtp(credentials: {
  user: string
  pass: string
}): Promise<FakeSmtp> {
  const messages: string[] = []
  const authAttempts: { user: string; pass: string }[] = []
  const commands: string[] = []
  const sockets = new Set<net.Socket>()

  const server = net.createServer((socket) => {
    sockets.add(socket)
    let buffer = ''
    let authed = false
    let inData = false
    let data = ''

    const send = (line: string): void => {
      socket.write(`${line}\r\n`)
    }

    socket.on('error', () => undefined)
    socket.on('close', () => sockets.delete(socket))
    send('220 fake ESMTP ready')

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let index = buffer.indexOf('\r\n')
      while (index >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        index = buffer.indexOf('\r\n')

        // Inside DATA everything is content until a lone "."
        if (inData) {
          if (line === '.') {
            inData = false
            messages.push(data)
            data = ''
            send('250 2.0.0 Ok: queued')
          } else {
            data += `${line}\r\n`
          }
          continue
        }

        commands.push(line)
        const upper = line.toUpperCase()

        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          // AUTH is advertised, so a client that ignores it is visibly wrong
          send('250-fake greets you')
          send('250-AUTH PLAIN LOGIN')
          send('250 OK')
        } else if (upper.startsWith('AUTH PLAIN')) {
          const encoded = line.split(/\s+/)[2] ?? ''
          const decoded = Buffer.from(encoded, 'base64').toString('utf8')
          // AUTH PLAIN is \0user\0pass
          const [, user = '', pass = ''] = decoded.split('\0')
          authAttempts.push({ user, pass })
          if (user === credentials.user && pass === credentials.pass) {
            authed = true
            send('235 2.7.0 Authentication successful')
          } else {
            send('535 5.7.8 Authentication credentials invalid')
          }
        } else if (upper.startsWith('MAIL FROM')) {
          if (!authed) send('530 5.7.0 Authentication required')
          else send('250 2.1.0 Ok')
        } else if (upper.startsWith('RCPT TO')) {
          send(authed ? '250 2.1.5 Ok' : '530 5.7.0 Authentication required')
        } else if (upper === 'DATA') {
          if (!authed) {
            send('530 5.7.0 Authentication required')
          } else {
            inData = true
            send('354 End data with <CR><LF>.<CR><LF>')
          }
        } else if (upper === 'QUIT') {
          send('221 2.0.0 Bye')
          socket.end()
        } else {
          send('250 2.0.0 Ok')
        }
      }
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        port,
        messages,
        authAttempts,
        commands,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy()
            server.close(() => done())
          })
      })
    })
  })
}
