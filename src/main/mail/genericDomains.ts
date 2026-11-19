// Mail providers say nothing about the company or show behind an address: a gmail.com sender
// is matched by the address alone, never by its domain (#235, #236)
export const GENERIC_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'gmx.de',
  'gmx.net',
  'gmx.at',
  'web.de',
  't-online.de',
  'outlook.com',
  'outlook.de',
  'hotmail.com',
  'hotmail.de',
  'live.de',
  'yahoo.com',
  'yahoo.de',
  'icloud.com',
  'me.com',
  'aol.com',
  'freenet.de',
  'posteo.de',
  'mailbox.org',
  'bluewin.ch',
  'protonmail.com',
  'proton.me'
])
