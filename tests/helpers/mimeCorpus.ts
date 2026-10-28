// Generated MIME messages covering the structures a mailbox meets: alternative, related with
// cid images, attached and inline forwarded messages, single-part attachments, RFC 2231 and
// encoded-word filenames, delivery reports. Nonsense content, example.test addresses, and
// deterministic bytes for the binary parts, so a run can compare without printing anything.

export interface CorpusMail {
  /** Short structural name, safe to print */
  name: string
  /** True for the one message whose attachment is large enough to measure the skeleton's saving */
  big?: boolean
  mime: Buffer
}

/** Deterministic pseudo-random bytes */
function bytes(n: number, seed: number): Buffer {
  const b = Buffer.alloc(n)
  let x = seed >>> 0
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0
    b[i] = x >>> 24
  }
  return b
}

/** Base64 in 76-character lines */
const b64 = (buf: Buffer): string =>
  buf.toString('base64').replace(/.{76}/g, '$&\n').replace(/\n?$/, '\n')

const ew = (s: string): string => `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`

export function mimeCorpus(subjectPrefix: string, to: string): CorpusMail[] {
  const head = (n: number, type: string): string =>
    `From: sender@example.test\nTo: ${to}\nSubject: ${subjectPrefix}${n}\nMessage-ID: <${subjectPrefix}${n}@example.test>\n` +
    `Date: Tue, 27 Oct 2026 10:00:00 +0100\nMIME-Version: 1.0\nContent-Type: ${type}\n`
  const pdf = (
    seed: number,
    size: number,
    name = 'datei.pdf',
    disposition = 'attachment'
  ): string =>
    `Content-Type: application/pdf; name="${name}"\nContent-Transfer-Encoding: base64\n` +
    `Content-Disposition: ${disposition}; filename="${name}"\n\n${b64(bytes(size, seed))}`
  const mails: [string, string, boolean?][] = [
    [
      'plain',
      head(1, 'text/plain; charset=utf-8') +
        'Content-Transfer-Encoding: 8bit\n\nGrüße aus dem Korpus.\n'
    ],
    [
      'alternative',
      head(2, 'multipart/alternative; boundary="b2"') +
        '\n--b2\nContent-Type: text/plain; charset=utf-8\n\nNur Text.\n' +
        '--b2\nContent-Type: text/html; charset=utf-8\n\n<p>Nur <b>HTML</b>.</p>\n--b2--\n'
    ],
    [
      'mixed alternative + large pdf',
      head(3, 'multipart/mixed; boundary="b3o"') +
        '\n--b3o\nContent-Type: multipart/alternative; boundary="b3i"\n\n' +
        '--b3i\nContent-Type: text/plain; charset=utf-8\n\nAnbei.\n' +
        '--b3i\nContent-Type: text/html; charset=utf-8\n\n<p>Anbei.</p>\n--b3i--\n\n' +
        `--b3o\n${pdf(3, 200_000, 'gross.pdf')}--b3o--\n`,
      true
    ],
    [
      'mixed related html + cid image + zip',
      head(4, 'multipart/mixed; boundary="b4o"') +
        '\n--b4o\nContent-Type: multipart/related; boundary="b4r"; type="text/html"\n\n' +
        '--b4r\nContent-Type: text/html; charset=utf-8\n\n<p>Logo: <img src="cid:logo4@example.test"></p>\n' +
        '--b4r\nContent-Type: image/png; name="logo.png"\nContent-Transfer-Encoding: base64\n' +
        `Content-ID: <logo4@example.test>\nContent-Disposition: inline; filename="logo.png"\n\n${b64(bytes(2048, 4))}--b4r--\n\n` +
        '--b4o\nContent-Type: application/zip; name="paket.zip"\nContent-Transfer-Encoding: base64\n' +
        `Content-Disposition: attachment; filename="paket.zip"\n\n${b64(bytes(30_000, 40))}--b4o--\n`
    ],
    [
      'forwarded message attachment with pdf',
      head(5, 'multipart/mixed; boundary="b5o"') +
        '\n--b5o\nContent-Type: text/plain; charset=utf-8\n\nWeitergeleitet.\n' +
        '--b5o\nContent-Type: message/rfc822\nContent-Disposition: attachment; filename="original.eml"\n\n' +
        'From: other@example.test\nTo: sender@example.test\nSubject: inner five\nMIME-Version: 1.0\n' +
        'Content-Type: multipart/mixed; boundary="b5i"\n\n--b5i\nContent-Type: text/plain; charset=utf-8\n\nInnen.\n' +
        `--b5i\n${pdf(5, 20_000, 'innen.pdf')}--b5i--\n\n--b5o--\n`
    ],
    [
      'inline forwarded single-part message',
      head(6, 'multipart/mixed; boundary="b6"') +
        '\n--b6\nContent-Type: text/plain; charset=utf-8\n\nSiehe unten.\n' +
        '--b6\nContent-Type: message/rfc822\n\n' +
        'From: other@example.test\nTo: sender@example.test\nSubject: inner six\nMIME-Version: 1.0\n' +
        'Content-Type: text/plain; charset=utf-8\n\nInnerer Text.\n\n--b6--\n'
    ],
    [
      'single-part pdf',
      head(7, 'application/pdf; name="nur.pdf"') +
        `Content-Transfer-Encoding: base64\nContent-Disposition: attachment; filename="nur.pdf"\n\n${b64(bytes(15_000, 7))}`
    ],
    [
      'RFC 2231 and encoded-word filenames',
      head(8, 'multipart/mixed; boundary="b8"') +
        '\n--b8\nContent-Type: text/plain; charset=utf-8\n\nZwei Dateien.\n' +
        '--b8\nContent-Type: application/pdf\nContent-Transfer-Encoding: base64\n' +
        `Content-Disposition: attachment; filename*=UTF-8''%C3%9Cbersicht%20Tour.pdf\n\n${b64(bytes(4000, 8))}` +
        '--b8\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\n' +
        `Content-Transfer-Encoding: base64\nContent-Disposition: attachment; filename="${ew('Vertrag Größe.docx')}"\n\n` +
        `${b64(bytes(6000, 80))}--b8--\n`
    ],
    [
      'text attachment + inline calendar',
      head(9, 'multipart/mixed; boundary="b9"') +
        '\n--b9\nContent-Type: text/plain; charset=utf-8\n\nTermin anbei.\n' +
        '--b9\nContent-Type: text/plain; charset=utf-8; name="notiz.txt"\nContent-Disposition: attachment; filename="notiz.txt"\n\nNotizzeile.\n' +
        '--b9\nContent-Type: text/calendar; charset=utf-8; method=REQUEST\n\n' +
        'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:s1-9@example.test\nSUMMARY:Probe\nEND:VEVENT\nEND:VCALENDAR\n--b9--\n'
    ],
    [
      'delivery report',
      head(10, 'multipart/report; report-type=delivery-status; boundary="b10"') +
        '\n--b10\nContent-Type: text/plain; charset=utf-8\n\nZustellung fehlgeschlagen.\n' +
        '--b10\nContent-Type: message/delivery-status\n\nReporting-MTA: dns; mx.example.test\n\n' +
        'Final-Recipient: rfc822; nobody@example.test\nAction: failed\nStatus: 5.1.1\n' +
        '--b10\nContent-Type: text/rfc822-headers\n\nFrom: sender@example.test\nSubject: lost\n--b10--\n'
    ],
    [
      'single-part quoted-printable latin-1 html',
      head(11, 'text/html; charset=iso-8859-1') +
        'Content-Transfer-Encoding: quoted-printable\n\n<p>Gr=FC=DFe, sch=F6n=\n</p>\n'
    ],
    [
      'csv attachment',
      head(12, 'multipart/mixed; boundary="b12"') +
        '\n--b12\nContent-Type: text/plain; charset=utf-8\n\nListe.\n' +
        '--b12\nContent-Type: text/csv; charset=utf-8; name="liste.csv"\nContent-Disposition: attachment; filename="liste.csv"\n\n' +
        'a;b;c\n1;2;3\n4;5;6\n--b12--\n'
    ],
    [
      'alternative with related html, plus pdf',
      head(13, 'multipart/mixed; boundary="b13o"') +
        '\n--b13o\nContent-Type: multipart/alternative; boundary="b13a"\n\n' +
        '--b13a\nContent-Type: text/plain; charset=utf-8\n\nSignatur.\n' +
        '--b13a\nContent-Type: multipart/related; boundary="b13r"\n\n' +
        '--b13r\nContent-Type: text/html; charset=utf-8\n\n<p><img src="cid:sig13@example.test"></p>\n' +
        '--b13r\nContent-Type: image/jpeg\nContent-Transfer-Encoding: base64\nContent-ID: <sig13@example.test>\n\n' +
        `${b64(bytes(3000, 13))}--b13r--\n\n--b13a--\n\n--b13o\n${pdf(130, 9000)}--b13o--\n`
    ],
    [
      'cid image marked as attachment',
      head(14, 'multipart/mixed; boundary="b14"') +
        '\n--b14\nContent-Type: text/html; charset=utf-8\n\n<p><img src="cid:pic14@example.test"></p>\n' +
        '--b14\nContent-Type: image/gif; name="bild.gif"\nContent-Transfer-Encoding: base64\n' +
        `Content-ID: <pic14@example.test>\nContent-Disposition: attachment; filename="bild.gif"\n\n${b64(bytes(1500, 14))}--b14--\n`
    ]
  ]
  return mails.map(([name, text, big]) => ({
    name,
    big,
    mime: Buffer.from(text.replace(/\r?\n/g, '\r\n'), 'utf8')
  }))
}
