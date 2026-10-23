// Fills a mailbox of the local sandbox Dovecot with a believable booking-office mailbox:
// venue requests and replies in threads, contracts and invoices as PDF, riders, hotel
// confirmations, newsletters with remote images, a calendar invite, a forwarded mail and a
// few odd ones (no subject, emoji, very long subject). Everything is made up and addressed
// to example.test; the same run always produces the same mails.
//   node scripts/seed-mail-sandbox.mjs                      bookingum-dev@example.test on 10144
//   node scripts/seed-mail-sandbox.mjs --port 10143 --user someone@example.test
//   node scripts/seed-mail-sandbox.mjs --reset              empty that mailbox first
// Loopback only, and never testuser@example.test (the prototype's harnesses use it).
// The sandbox accepts any user name with its password, so a new name is a new mailbox.
import { ImapFlow } from 'imapflow'
import { crc32, deflateSync } from 'zlib'
import MailComposer from 'nodemailer/lib/mail-composer/index.js'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const HOST = argOf('--host', '127.0.0.1')
const PORT = Number(argOf('--port', '10144'))
const USER = argOf('--user', 'bookingum-dev@example.test')
const PASS = process.env.MAIL_SANDBOX_PASS ?? 'testpass'
const RESET = args.includes('--reset')

if (!['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
  console.error(`refusing ${HOST}: the seed only writes to the local sandbox`)
  process.exit(2)
}
if (USER.toLowerCase() === 'testuser@example.test') {
  console.error('refusing testuser@example.test: other harnesses work on that mailbox')
  process.exit(2)
}

// ----- the made-up world -----

const ME = { name: 'Booking-Büro Dev', address: USER }
const NOW = Date.UTC(2026, 9, 23, 17, 0)
const DAY = 86_400_000

// deterministic, so a reset and a new seed give the same mailbox
let state = 0x5eed
const rand = () => {
  state = (state + 0x6d2b79f5) | 0
  let t = Math.imul(state ^ (state >>> 15), 1 | state)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (list) => list[Math.floor(rand() * list.length)]
const daysAgo = (min, max) => {
  const d = new Date(NOW - (min + rand() * (max - min)) * DAY)
  d.setUTCHours(7 + Math.floor(rand() * 12), Math.floor(rand() * 60), 0, 0)
  return d
}
const fmtDate = (d) =>
  d.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC'
  })

const BANDS = [
  {
    name: 'Die Nachtfalter',
    genre: 'Indie-Pop',
    size: 4,
    fee: 1800,
    contact: { name: 'Jana Petersen', address: 'jana@nachtfalter.example.test' }
  },
  {
    name: 'Kupferkessel',
    genre: 'Folk-Rock',
    size: 6,
    fee: 2400,
    contact: { name: 'Malte Hohmann', address: 'malte@kupferkessel.example.test' }
  },
  {
    name: 'Lumen Drift',
    genre: 'Post-Rock',
    size: 3,
    fee: 1200,
    contact: { name: 'Svenja Kraus', address: 'svenja@lumendrift.example.test' }
  },
  {
    name: 'The Static Owls',
    genre: 'Garage',
    size: 4,
    fee: 1500,
    contact: { name: 'Deniz Aydın', address: 'deniz@staticowls.example.test' }
  }
]
const VENUES = [
  {
    name: 'Kulturhalle Nordstadt',
    city: 'Nordstadt',
    capacity: 650,
    contact: { name: 'Lukas Brenner', address: 'programm@kulturhalle-nordstadt.example.test' },
    tech: { name: 'Technik Kulturhalle', address: 'technik@kulturhalle-nordstadt.example.test' },
    re: 'AW'
  },
  {
    name: 'Club Kesselhaus',
    city: 'Altstadt',
    capacity: 280,
    contact: { name: 'Ilka Voss', address: 'ilka.voss@kesselhaus.example.test' },
    tech: { name: 'Tom (FOH Kesselhaus)', address: 'foh@kesselhaus.example.test' },
    re: 'Re'
  },
  {
    name: 'Sommerwiese Festival',
    city: 'Brückenau',
    capacity: 4000,
    contact: { name: 'Festivalbüro Sommerwiese', address: 'booking@sommerwiese.example.test' },
    tech: { name: 'Produktion Sommerwiese', address: 'produktion@sommerwiese.example.test' },
    re: 'AW'
  },
  {
    name: 'Jugendzentrum Altdorf',
    city: 'Altdorf',
    capacity: 150,
    contact: { name: 'Paula Schmitt', address: 'paula@juz-altdorf.example.test' },
    tech: { name: 'Paula Schmitt', address: 'paula@juz-altdorf.example.test' },
    re: 'Re'
  },
  {
    name: 'Stadtfest Brückenau',
    city: 'Brückenau',
    capacity: 2500,
    contact: { name: 'Kulturamt Brückenau', address: 'kulturamt@brueckenau.example.test' },
    tech: { name: 'Bühnenservice Ost', address: 'dispo@buehnenservice-ost.example.test' },
    re: 'AW'
  }
]
const SUPPLIERS = [
  {
    name: 'Tourbus Vermietung Lenz',
    address: 'buchhaltung@tourbus-lenz.example.test',
    item: 'Nightliner, 3 Tage inkl. Fahrer'
  },
  {
    name: 'Druckerei Schwarz & Weiß',
    address: 'rechnung@druckerei-sw.example.test',
    item: 'Plakate A1, 250 Stück'
  },
  {
    name: 'Backline-Verleih Krüger',
    address: 'info@backline-krueger.example.test',
    item: 'Drumkit und 2 Gitarrenamps, Wochenende'
  },
  {
    name: 'Steuerbüro Hartmann',
    address: 'kanzlei@stb-hartmann.example.test',
    item: 'Buchhaltung Q3'
  }
]
const HOTELS = [
  { name: 'Hotel am Ring', address: 'reservierung@hotel-am-ring.example.test' },
  { name: 'Pension Lindenhof', address: 'info@lindenhof.example.test' }
]

const sig = `\n\nViele Grüße\nBooking-Büro Dev\nTel. 0000 123456 · ${USER}`

// a one-page PDF with a few lines of text, built by hand so it needs no library
function pdf(lines) {
  const text = lines
    .map(
      (l, i) =>
        `BT /F1 12 Tf 56 ${780 - i * 18} Td (${l.replace(/[()\\]/g, '\\$&').replace(/[^\x20-\x7e]/g, '?')}) Tj ET`
    )
    .join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let out = '%PDF-1.4\n'
  const offsets = objects.map((body, i) => {
    const at = out.length
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
    return at
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

// a small solid-colour PNG (a stand-in press photo)
function png(size, [r, g, b]) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 2, 0, 0, 0], 8) // 8 bit RGB
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.alloc(size * 3).map((_, i) => [r, g, b][i % 3])
  ])
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(size).fill(row)))),
    chunk('IEND', Buffer.alloc(0))
  ])
}
const PRESS_PHOTO = png(64, [42, 77, 105])

// ----- the mails -----

/** @type {{ folder: string, flags: string[], mail: object }[]} */
const mails = []
let seq = 0
const id = () => `<seed-${++seq}@bookingum-dev.example.test>`
function add(folder, mail, flags = ['\\Seen']) {
  const messageId = mail.messageId ?? id()
  mails.push({ folder, flags, mail: { ...mail, messageId } })
  return messageId
}
const quote = (from, date, text) =>
  `\n\nAm ${fmtDate(date)} schrieb ${from.name}:\n` +
  text
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')

/** A venue asks for a band; we answer with an offer; they confirm or decline */
function requestThread(band, venue, ageDays, { folder, outcome }) {
  const asked = daysAgo(ageDays, ageDays + 2)
  const show = new Date(NOW + (20 + rand() * 200) * DAY)
  const subject = `Anfrage: ${band.name} am ${fmtDate(show)} – ${venue.name}`
  const askText =
    `Hallo zusammen,\n\nwir würden ${band.name} gern am ${fmtDate(show)} im ${venue.name} (${venue.city}, ` +
    `${venue.capacity} Plätze) präsentieren. Ist der Termin noch frei? Wir könnten eine Festgage oder ` +
    `einen Door-Deal anbieten, Catering und zwei Hotelzimmer übernehmen wir.\n\nWas bräuchtet ihr technisch?\n\n` +
    `Beste Grüße\n${venue.contact.name}\n${venue.name}`
  const askId = add(
    folder,
    { from: venue.contact, to: ME, subject, text: askText, date: asked },
    outcome === 'open' ? [] : ['\\Seen', '\\Answered']
  )
  if (outcome === 'open') return

  const offered = new Date(asked.getTime() + (0.2 + rand()) * DAY)
  const offerText =
    `Hallo ${venue.contact.name.split(' ')[0]},\n\ndanke für die Anfrage! Der ${fmtDate(show)} ist für ` +
    `${band.name} noch frei. Unser Angebot: ${band.fee} € Festgage zzgl. MwSt., ${band.size} Personen ` +
    `plus Tontechnik, Übernachtung in Doppelzimmern. Rider und Bühnenplan schicke ich mit dem Vertrag.` +
    sig +
    quote(venue.contact, asked, askText)
  const offerId = add('Sent', {
    from: ME,
    to: venue.contact,
    subject: `Re: ${subject}`,
    text: offerText,
    date: offered,
    inReplyTo: askId,
    references: [askId]
  })

  const answered = new Date(offered.getTime() + (0.5 + rand() * 3) * DAY)
  const yes = outcome === 'confirmed'
  const answerText =
    (yes
      ? `Hallo,\n\nsuper, das passt für uns. Bitte schickt den Vertrag, dann machen wir den Termin fest. ` +
        `Vorverkauf würden wir in zwei Wochen starten.`
      : `Hallo,\n\nleider ist das Budget für dieses Jahr ausgeschöpft, wir müssen absagen. ` +
        `Vielleicht klappt es im Frühjahr – wir melden uns.`) +
    `\n\nGrüße\n${venue.contact.name}` +
    quote(ME, offered, offerText)
  add(
    folder,
    {
      from: venue.contact,
      to: ME,
      subject: `${venue.re}: ${subject}`,
      text: answerText,
      date: answered,
      inReplyTo: offerId,
      references: [askId, offerId]
    },
    ageDays < 6 ? [] : ['\\Seen']
  )

  if (!yes) return
  // contract out, signed contract back
  const contractNo = `V-2026-${String(100 + seq).padStart(4, '0')}`
  const sent = new Date(answered.getTime() + 0.3 * DAY)
  const contractId = add('Sent', {
    from: ME,
    to: venue.contact,
    subject: `Vertrag ${contractNo}: ${band.name}, ${fmtDate(show)}`,
    text: `Hallo,\n\nanbei der Vertrag zum Gegenzeichnen.` + sig,
    date: sent,
    attachments: [
      {
        filename: `Vertrag_${contractNo}.pdf`,
        contentType: 'application/pdf',
        content: pdf([
          `Gastspielvertrag ${contractNo}`,
          `${band.name} – ${venue.name}`,
          `Termin: ${fmtDate(show)}`,
          `Gage: ${band.fee} EUR zzgl. MwSt.`
        ])
      }
    ]
  })
  if (sent.getTime() + 2 * DAY < NOW) {
    add('Verträge', {
      from: venue.contact,
      to: ME,
      subject: `${venue.re}: Vertrag ${contractNo}: ${band.name}, ${fmtDate(show)}`,
      text: `Anbei unterschrieben zurück. Danke!\n\n${venue.contact.name}`,
      date: new Date(sent.getTime() + 2 * DAY),
      inReplyTo: contractId,
      references: [contractId],
      attachments: [
        {
          filename: `Vertrag_${contractNo}_unterschrieben.pdf`,
          contentType: 'application/pdf',
          content: pdf([
            `Gastspielvertrag ${contractNo} (unterschrieben)`,
            `${band.name} – ${venue.name}`
          ])
        }
      ]
    })
  }
}

// the inbox: what is going on right now
requestThread(BANDS[0], VENUES[0], 2, { folder: 'INBOX', outcome: 'open' })
requestThread(BANDS[1], VENUES[2], 4, { folder: 'INBOX', outcome: 'confirmed' })
requestThread(BANDS[2], VENUES[1], 5, { folder: 'INBOX', outcome: 'declined' })
requestThread(BANDS[3], VENUES[3], 1, { folder: 'INBOX', outcome: 'open' })
requestThread(BANDS[0], VENUES[4], 9, { folder: 'INBOX', outcome: 'confirmed' })
requestThread(BANDS[1], VENUES[1], 0.3, { folder: 'INBOX', outcome: 'open' })
// older requests, filed
let age = 20
for (const band of BANDS) {
  for (const venue of VENUES) {
    if (rand() < 0.45) continue
    requestThread(band, venue, age, {
      folder: 'Anfragen',
      outcome: pick(['confirmed', 'declined', 'declined', 'confirmed', 'open'])
    })
    age += 4 + rand() * 6
  }
}

// technical questions from venues, flagged until answered
for (const [band, venue] of [
  [BANDS[1], VENUES[2]],
  [BANDS[0], VENUES[4]],
  [BANDS[3], VENUES[1]]
]) {
  add(
    'INBOX',
    {
      from: venue.tech,
      to: ME,
      cc: band.contact,
      subject: `Technik ${band.name}: Bühnenplan & Rider`,
      text:
        `Moin,\n\nfür ${band.name} brauche ich noch:\n\n1. aktuellen Stageplot\n2. Inputliste (wie viele Kanäle?)\n` +
        `3. Bringt ihr eigenen Monitormix mit?\n4. Ankunft und Soundcheck – passt 15:30?\n\nDanke!\n${venue.tech.name}`,
      date: daysAgo(1, 6)
    },
    ['\\Flagged']
  )
}

// hotel confirmations (HTML)
for (const hotel of HOTELS) {
  const nr = `${4700 + Math.floor(rand() * 300)}-${Math.floor(rand() * 90 + 10)}`
  add(
    'INBOX',
    {
      from: hotel,
      to: ME,
      subject: `Buchungsbestätigung Nr. ${nr}`,
      text: `Buchungsbestätigung ${nr}\n3 Doppelzimmer, Anreise ${fmtDate(daysAgo(-30, -10))}, 1 Nacht, inkl. Frühstück.`,
      html:
        `<div style="font-family:Arial,sans-serif;max-width:560px"><h2 style="color:#2a4d69">${hotel.name}</h2>` +
        `<p>Vielen Dank für Ihre Reservierung.</p><table cellpadding="6" style="border-collapse:collapse">` +
        `<tr><td><b>Buchungsnummer</b></td><td>${nr}</td></tr><tr><td><b>Zimmer</b></td><td>3 × Doppelzimmer</td></tr>` +
        `<tr><td><b>Frühstück</b></td><td>inklusive</td></tr></table>` +
        `<p style="color:#777;font-size:12px">Stornierung bis 48 h vor Anreise kostenfrei.</p></div>`,
      date: daysAgo(2, 12)
    },
    rand() < 0.5 ? [] : ['\\Seen']
  )
}

// supplier invoices
let invoiceNo = 230
for (let i = 0; i < 9; i++) {
  const s = SUPPLIERS[i % SUPPLIERS.length]
  const amount = (180 + Math.floor(rand() * 2200)).toFixed(2).replace('.', ',')
  const no = `RE-2026-${++invoiceNo}`
  const date = daysAgo(i * 9 + 1, i * 9 + 6)
  add(
    i < 2 ? 'INBOX' : 'Rechnungen',
    {
      from: { name: s.name, address: s.address },
      to: ME,
      subject: `Rechnung ${no}`,
      text:
        `Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie unsere Rechnung ${no} über ${amount} € für: ${s.item}.\n` +
        `Zahlbar innerhalb von 14 Tagen ohne Abzug.\n\nMit freundlichen Grüßen\n${s.name}`,
      date,
      attachments: [
        {
          filename: `${no}.pdf`,
          contentType: 'application/pdf',
          content: pdf([
            `${s.name}`,
            `Rechnung ${no}`,
            `Datum: ${fmtDate(date)}`,
            `${s.item}`,
            `Betrag: ${amount} EUR`
          ])
        }
      ]
    },
    i < 2 ? [] : ['\\Seen']
  )
}

// mails from the bands, in their folders
for (const band of BANDS.slice(0, 3)) {
  const folder = `Bands/${band.name}`
  const topics = [
    ['Setlist für die Herbsttour', 'Hier die Setlist, 14 Songs, ca. 70 Minuten. Zugabe offen.'],
    ['Neue Pressefotos', 'Die neuen Fotos sind fertig, bitte ab sofort nur noch diese verwenden.'],
    [
      'Verfügbarkeiten Frühjahr',
      'Im März sind wir komplett frei, im April nur an den Wochenenden.'
    ],
    ['Merch-Bestellung', 'Wir brauchen 100 Shirts nach, Größen wie letztes Mal.'],
    ['Fahrtkosten Oktober', 'Hier die Tankbelege der letzten drei Shows, Summe 412,80 €.'],
    ['Rider aktualisiert', 'Wir haben jetzt einen zweiten Keyboarder dabei – bitte Rider anpassen.']
  ]
  topics.forEach(([topic, line], i) => {
    add(
      folder,
      {
        from: band.contact,
        to: ME,
        subject: `${band.name}: ${topic}`,
        text: `Hi!\n\n${line}\n\nLG ${band.contact.name.split(' ')[0]}`,
        date: daysAgo(i * 11 + 3, i * 11 + 9),
        attachments:
          i === 1
            ? [{ filename: 'pressefoto_klein.png', contentType: 'image/png', content: PRESS_PHOTO }]
            : undefined
      },
      i === 0 ? ['\\Seen', '\\Flagged'] : ['\\Seen']
    )
  })
}

// newsletters: HTML with remote images and an unsubscribe header
const LETTERS = [
  ['Live-Branche kompakt', 'news@livebranche.example.test'],
  ['Förderkompass Kultur', 'info@foerderkompass.example.test'],
  ['Bühnentechnik Aktuell', 'newsletter@buehnentechnik.example.test']
]
for (let i = 0; i < 10; i++) {
  const [name, address] = LETTERS[i % LETTERS.length]
  const month = new Date(NOW - i * 12 * DAY).toLocaleDateString('de-DE', {
    month: 'long',
    timeZone: 'UTC'
  })
  add(
    i < 2 ? 'INBOX' : 'Newsletter',
    {
      from: { name, address },
      to: ME,
      subject: `${name} – Ausgabe ${month}`,
      headers: { 'List-Unsubscribe': `<https://${address.split('@')[1]}/abmelden?id=dev>` },
      text: `${name}\n\nDie Themen dieser Ausgabe: neue Festivals, Förderfristen, Technik-Tipps.\n\nAbmelden: https://${address.split('@')[1]}/abmelden`,
      html:
        `<table width="100%" cellpadding="0" style="background:#f3f3f3"><tr><td align="center">` +
        `<table width="600" style="background:#fff;font-family:Georgia,serif">` +
        `<tr><td><img src="https://images.${address.split('@')[1]}/header-${i}.jpg" width="600" alt="${name}"></td></tr>` +
        `<tr><td style="padding:20px"><h1 style="font-size:22px">${name}</h1>` +
        `<p>Neue Festivals suchen Acts für 2027, die Förderfrist für Tourzuschüsse endet bald, und wir testen drei In-Ear-Systeme.</p>` +
        `<p><a href="https://${address.split('@')[1]}/ausgabe/${i}" style="color:#c0392b">Weiterlesen →</a></p>` +
        `<img src="https://track.${address.split('@')[1]}/open.gif?u=dev" width="1" height="1" alt="">` +
        `</td></tr><tr><td style="padding:12px;font-size:11px;color:#999">` +
        `<a href="https://${address.split('@')[1]}/abmelden">Abmelden</a></td></tr></table></td></tr></table>`,
      date: daysAgo(i * 12, i * 12 + 1)
    },
    i === 0 ? [] : ['\\Seen']
  )
}

// a calendar invite
add(
  'INBOX',
  {
    from: BANDS[1].contact,
    to: ME,
    cc: BANDS[0].contact,
    subject: 'Einladung: Tourplanung 2027',
    text: 'Lass uns die Tour 2027 durchplanen – Termin im Anhang.',
    date: daysAgo(0.5, 1),
    icalEvent: {
      method: 'REQUEST',
      content:
        'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Bookingium Seed//DE\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\n' +
        'UID:seed-tourplanung-2027@example.test\r\nDTSTAMP:20261022T090000Z\r\nDTSTART:20261104T150000Z\r\n' +
        'DTEND:20261104T170000Z\r\nSUMMARY:Tourplanung 2027\r\nLOCATION:Proberaum Kupferkessel\r\n' +
        `ORGANIZER:mailto:${BANDS[1].contact.address}\r\nATTENDEE;RSVP=TRUE:mailto:${USER}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`
    }
  },
  []
)

// a forwarded mail, as message/rfc822
const forwarded = await new MailComposer({
  from: VENUES[2].contact,
  to: BANDS[1].contact,
  subject: 'Anreise Sommerwiese: Lageplan',
  text: 'Anfahrt über das Nordtor, Backstage-Parkplatz P3. Bändchen gibt es am Produktionsbüro.',
  date: daysAgo(3, 4),
  messageId: id()
})
  .compile()
  .build()
add(
  'INBOX',
  {
    from: BANDS[1].contact,
    to: ME,
    subject: 'WG: Anreise Sommerwiese: Lageplan',
    text: 'Zur Info, kam bei mir an. Kannst du das an den Fahrer weitergeben?\n\nMalte',
    date: daysAgo(2, 3),
    attachments: [
      { filename: 'Anreise Sommerwiese.eml', contentType: 'message/rfc822', content: forwarded }
    ]
  },
  []
)

// odd ones
add(
  'INBOX',
  {
    from: { name: '', address: 'noreply@ticketshop.example.test' },
    to: ME,
    subject: '',
    text: 'Ihr Vorverkaufsbericht ist bereit: 312 verkaufte Tickets, Stand gestern 23:59 Uhr.',
    date: daysAgo(1, 2)
  },
  []
)
add(
  'INBOX',
  {
    from: VENUES[1].tech,
    to: ME,
    subject: '🎸 Soundcheck verschoben – jetzt 16:00 Uhr!',
    text: 'Kurze Info: wegen einer Lieferung verschiebt sich der Soundcheck um 30 Minuten.',
    date: daysAgo(0.1, 0.4)
  },
  []
)
add(
  'INBOX',
  {
    from: VENUES[0].contact,
    to: ME,
    cc: [
      BANDS[0].contact,
      BANDS[2].contact,
      VENUES[0].tech,
      { name: 'Abendkasse', address: 'kasse@kulturhalle-nordstadt.example.test' }
    ],
    subject:
      'Wichtig: Änderungen beim Einlass, bei der Abendkasse, bei den Gästelisten und bei der Anlieferung für alle Veranstaltungen ab November 2026 – bitte unbedingt lesen und an die Bands weitergeben',
    text: 'Ab November gelten neue Regeln:\n\n- Einlass 30 Minuten früher\n- Gästeliste bis 18 Uhr am Vortag\n- Anlieferung nur über den Hof\n\nDanke!',
    date: daysAgo(3, 5)
  },
  ['\\Seen', '\\Flagged']
)

// archive: last year's season
for (let i = 0; i < 12; i++) {
  const band = BANDS[i % BANDS.length]
  const venue = VENUES[(i * 3) % VENUES.length]
  add('Archive', {
    from: venue.contact,
    to: ME,
    subject: `Abrechnung ${band.name} – ${venue.name}`,
    text: `Hallo,\n\nanbei die Abrechnung zum Konzert von ${band.name}: ${Math.floor(80 + rand() * 500)} zahlende Gäste.\n\nGrüße\n${venue.contact.name}`,
    date: daysAgo(330 + i * 10, 335 + i * 10)
  })
}

// drafts and trash
add(
  'Drafts',
  {
    from: ME,
    to: VENUES[0].contact,
    subject: `Re: Anfrage: ${BANDS[0].name}`,
    text: 'Hallo Lukas,\n\ndanke für die Anfrage, ich kläre gerade mit der Band, ob',
    date: daysAgo(0.2, 0.3)
  },
  ['\\Seen', '\\Draft']
)
add(
  'Drafts',
  {
    from: ME,
    to: SUPPLIERS[0],
    subject: 'Nightliner für März?',
    text: 'Hallo,\n\nhabt ihr vom 12. bis 15. März einen Nightliner frei?',
    date: daysAgo(4, 5)
  },
  ['\\Seen', '\\Draft']
)
for (let i = 0; i < 3; i++) {
  add('Trash', {
    from: { name: 'Gewinnspiel-Team', address: `promo${i}@angebote.example.test` },
    to: ME,
    subject: 'Sie haben gewonnen!!!',
    text: 'Klicken Sie hier, um Ihren Preis abzuholen.',
    date: daysAgo(6 + i * 3, 7 + i * 3)
  })
}

// ----- write them -----

const client = new ImapFlow({
  host: HOST,
  port: PORT,
  secure: false,
  auth: { user: USER, pass: PASS },
  logger: false
})
await client.connect()
try {
  const listed = await client.list()
  const delimiter = listed.find((f) => f.path === 'INBOX')?.delimiter ?? '/'
  const toPath = (folder) => folder.split('/').join(delimiter)
  const specialUse = new Map(listed.filter((f) => f.specialUse).map((f) => [f.specialUse, f.path]))
  const resolve = (folder) =>
    ({
      Sent: specialUse.get('\\Sent'),
      Drafts: specialUse.get('\\Drafts'),
      Trash: specialUse.get('\\Trash'),
      Archive: specialUse.get('\\Archive')
    })[folder] ?? toPath(folder)

  if (RESET) {
    // own folders deepest first, then empty the inbox and the special folders
    for (const f of [...listed].sort((a, b) => b.path.length - a.path.length)) {
      if (f.path === 'INBOX' || f.specialUse) {
        const lock = await client.getMailboxLock(f.path)
        try {
          if (client.mailbox.exists) await client.messageDelete('1:*')
        } finally {
          lock.release()
        }
      } else {
        await client.mailboxDelete(f.path)
      }
    }
  } else {
    const { messages = 0 } = await client.status('INBOX', { messages: true })
    if (messages > 0) {
      console.log(
        `${USER} on ${PORT} already has mail (${messages} in INBOX); --reset seeds it again`
      )
      mails.length = 0
    }
  }

  const present = new Set((await client.list()).map((f) => f.path))
  const counts = new Map()
  for (const { folder, flags, mail } of mails) {
    const path = resolve(folder)
    const parts = path.split(delimiter)
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join(delimiter)
      if (!present.has(p)) {
        await client.mailboxCreate(p)
        present.add(p)
      }
    }
    const raw = await new MailComposer(mail).compile().build()
    await client.append(path, raw, flags, mail.date)
    counts.set(path, (counts.get(path) ?? 0) + 1)
  }
  if (mails.length) console.log(`seeded ${mails.length} mails for ${USER} on ${HOST}:${PORT}`)
  for (const [path, n] of [...counts].sort()) console.log(`  ${String(n).padStart(3)}  ${path}`)
} finally {
  await client.logout().catch(() => client.close())
}
