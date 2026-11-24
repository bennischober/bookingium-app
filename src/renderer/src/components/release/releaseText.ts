import type { ReleaseDto } from '../../../../main/api/schemas/release.schema'

// Texts of a release (#289) shared by the list, the page and the band tab. Pure.

/** "Probealbum (Deluxe Edition)" */
export function releaseTitle(release: Pick<ReleaseDto, 'title' | 'version'>): string {
  return release.version ? `${release.title} (${release.version})` : release.title
}

/** "Probetrack (Radio Edit)" with the version in brackets */
export function trackTitle(track: { title: string; version: string }): string {
  return track.version ? `${track.title} (${track.version})` : track.title
}

/** Total of the known durations in seconds; null when none is known */
export function totalDuration(tracks: ReadonlyArray<{ durationSeconds: number | null }>) {
  const known = tracks.filter((track) => track.durationSeconds !== null)
  return known.length === 0
    ? null
    : known.reduce((total, track) => total + (track.durationSeconds ?? 0), 0)
}
