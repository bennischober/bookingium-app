// Characters Windows/macOS do not allow in file names
const INVALID_FILE_CHARS = /[<>:"/\\|?*]/g

/** Builds a safe file name (without extension) from name parts, skipping empty ones */
export function buildFileName(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) =>
      String(part ?? '')
        .replace(INVALID_FILE_CHARS, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .join('_')
}
