// Column names for a sheet without a header row ("Spalte A", "Spalte B", …). Pure, so the plan
// modules (tourDates.ts) and the renderer can tell such a sheet apart.

export function generatedHeader(index: number): string {
  let letters = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters
  }
  return `Spalte ${letters}`
}

/** Whether the headers are generated ones: the sheet had no header row */
export function hasGeneratedHeaders(headers: string[]): boolean {
  return headers.length > 0 && headers.every((header, index) => header === generatedHeader(index))
}
