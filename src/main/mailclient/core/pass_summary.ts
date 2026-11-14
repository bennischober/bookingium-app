// #156: the one line the host logs after each pass the user started (sync button, deep check),
// to judge the STATUS census pacing against a real server. Counts and times only: no folder
// names, subjects or addresses ever go into it. #157: the pacer's learned pause at the end and at
// its highest, and the throttling signals of the pass, to read its behaviour off a real server.
import type { PassSummary } from './types.js';

export function passSummaryLine(s: PassSummary): string {
  const pacing = s.pacing
    ? ` pause=${s.pacing.pauseMs}ms max-pause=${s.pacing.maxPauseMs}ms throttled=${s.pacing.signals}`
    : '';
  return `sync pass (${s.kind}): list-status=${s.listStatus ? 'yes' : 'no'} census-pause=${s.censusPauseMs}ms ` +
    `census=${s.censusMs}ms checked=${s.foldersChecked} synced=${s.foldersSynced} total=${s.totalMs}ms ` +
    `errors=${s.errors} ended=${s.phase} connection=${s.connection}${pacing}`;
}
