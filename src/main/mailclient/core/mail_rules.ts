// #124: the matching half of mail rules. The rules live in the app database; main hands their
// conditions in as plain lists, and only the ids of the mails that match leave the worker - the
// subject and the addresses are compared here and never cross IPC for this purpose.
import type { RuleMatcher } from './types.js';

/** The parts of a stored mail a rule looks at */
export interface RuleCandidate {
  fromEmail: string;
  fromName: string;
  /** To and Cc, addresses and names */
  recipients: string[];
  subject: string;
}

const fold = (s: string | null | undefined): string => (s ?? '').normalize('NFC').toLowerCase().trim();

/** True when one of `needles` occurs in one of `haystack` (case-insensitive); an empty list matches anything */
function containsAny(haystack: string[], needles: string[]): boolean {
  const wanted = needles.map(fold).filter(Boolean);
  if (wanted.length === 0) return true;
  const values = haystack.map(fold).filter(Boolean);
  return wanted.some(n => values.some(v => v.includes(n)));
}

/**
 * Every condition a rule names must hold; within one condition, one alternative is enough.
 * A rule without any condition matches nothing (main refuses to save one; this is the guard).
 */
export function ruleMatches(rule: RuleMatcher, mail: RuleCandidate): boolean {
  if (![...rule.from, ...rule.to, ...rule.subject].some(v => fold(v))) return false;
  return containsAny([mail.fromEmail, mail.fromName], rule.from)
    && containsAny(mail.recipients, rule.to)
    && containsAny([mail.subject], rule.subject);
}

/** The ids of the rules that match one mail, in the order given */
export function matchingRules(rules: RuleMatcher[], mail: RuleCandidate): number[] {
  return rules.filter(r => ruleMatches(r, mail)).map(r => r.id);
}

/** The addresses and names of a stored To/Cc JSON column, tolerating NULL and junk */
export function recipientsOf(raw: string | null): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  for (const a of parsed) {
    if (typeof a === 'string') { out.push(a); continue; }
    const entry = a as { email?: unknown; name?: unknown } | null;
    if (typeof entry?.email === 'string') out.push(entry.email);
    if (typeof entry?.name === 'string') out.push(entry.name);
  }
  return out;
}
