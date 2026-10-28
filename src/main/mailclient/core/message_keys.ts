// R2: the two keys mail linking matches on, out of core/index.ts, which still exports both.
import { createHash } from 'crypto';

/**
 * C2: a stable key for a mail without a Message-ID. The subject goes into the
 * hash and never leaves the worker in clear text for this purpose, so two mails
 * that differ only in subject stay distinct.
 */
export function messageFallbackKey(input: {
  date: string | null;
  fromEmail: string | null;
  sizeBytes: number | null;
  subject: string | null;
}): string {
  const normalized = [
    (input.date ?? '').trim(),
    (input.fromEmail ?? '').trim().toLowerCase(),
    String(input.sizeBytes ?? ''),
    (input.subject ?? '').trim(),
  ].join('|');
  return createHash('sha1').update(normalized, 'utf8').digest('hex');
}

/** A Message-ID without its angle brackets, so both forms compare equal */
export function normalizeMessageId(raw: string | null | undefined): string {
  return (raw ?? '').replace(/^</, '').replace(/>$/, '').trim();
}
