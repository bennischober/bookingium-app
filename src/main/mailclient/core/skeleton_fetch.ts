// S1: fetching a large message as its skeleton (core/skeleton.ts). The download pass and the
// repair sweep, the two server paths the threshold applies to, both store through here. Never
// called inside a running fetch loop: imapflow sends the next command only after the current one.
import type { ImapFlow, MessageStructureObject } from 'imapflow';
import { buildSkeleton, estimatedPartSizes, skeletonSections } from './skeleton.js';

/** A message without its large parts: the skeleton, and each part's estimated size by `partId` */
export interface FetchedSkeleton { source: Buffer; partSizes: Map<string, number> }

/** True when a message of this server size is stored as its skeleton; an unset threshold stores everything whole */
export function storedAsSkeleton(lazyAboveBytes: number | undefined, size: number | undefined): boolean {
  return lazyAboveBytes !== undefined && size !== undefined && size > lazyAboveBytes;
}

/**
 * The skeleton of one message (BODYSTRUCTURE is fetched when the caller has none). Null when the
 * structure is not covered or the server left out a section: the caller downloads the message whole.
 */
export async function fetchSkeleton(client: ImapFlow, uid: number, structure?: MessageStructureObject): Promise<FetchedSkeleton | null> {
  if (!structure) {
    const meta = await client.fetchOne(String(uid), { uid: true, bodyStructure: true }, { uid: true });
    structure = meta ? meta.bodyStructure : undefined;
  }
  if (!structure) return null;
  const sections = skeletonSections(structure);
  if (!sections) return null;
  // imapflow sends bodyParts as BODY.PEEK, so \Seen stays as it is
  const parts = await client.fetchOne(String(uid), { uid: true, headers: true, ...(sections.length ? { bodyParts: sections } : {}) }, { uid: true });
  if (!parts || !parts.headers) return null;
  const source = buildSkeleton(structure, parts.headers, parts.bodyParts ?? new Map());
  return source ? { source, partSizes: estimatedPartSizes(structure) } : null;
}
