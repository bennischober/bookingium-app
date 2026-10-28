// The one door to the MIME parser: every message the core reads is parsed here, the downloaded
// source at ingest and a stored .eml when a call needs more than its row (an attachment's bytes,
// a draft's Bcc and files). Replacing mailparser (postal-mime), or reading a message whose large
// parts are not stored, is then a change in this file.
import fs from 'fs';
import { simpleParser, type ParsedMail } from 'mailparser';
import type { Store } from './store.js';

export type ParsedMessage = ParsedMail;

/** Parse a raw RFC 5322 message */
export function parseMessage(source: Buffer): Promise<ParsedMessage> {
  return simpleParser(source);
}

/** Read a stored message's .eml (`rel` is its row's `file_path`) and parse it */
export function parseStoredMessage(store: Store, rel: string): Promise<ParsedMessage> {
  return parseMessage(fs.readFileSync(store.filePath(rel)));
}
