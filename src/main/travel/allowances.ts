// Reisekostenabrechnung (#225, step 2): per diem allowances (Verpflegungsmehraufwand, § 9 Abs. 4a
// EStG), meal deductions and the mileage allowance of a business trip. Pure: the trip dialog
// shows the same numbers live that the report prints. All amounts are integer cents.
//
// Rates as of 2026 (unchanged since 2020): in Germany 14 € for an absence of more than 8 hours
// and for the arrival and departure day of a trip with an overnight stay, 28 € for a full day
// away. Abroad the BMF publishes rates per country each year; a trip abroad takes its two
// rates as entered. A meal provided by the employer or a business partner is deducted: 20 % of
// the full-day rate for breakfast, 40 % each for lunch and dinner, never below zero. Own car:
// 0,30 € per km driven, other motor vehicles 0,20 €.

export const DOMESTIC_RATES = { partialCents: 1400, fullCents: 2800 } as const
export const MILEAGE_CENTS_PER_KM = { car: 30, other: 20 } as const
export type Vehicle = keyof typeof MILEAGE_CENTS_PER_KM

export type TripDayKind = 'single' | 'arrival' | 'full' | 'departure'

export interface TripMeals {
  breakfast: boolean
  lunch: boolean
  dinner: boolean
}

export interface TripInput {
  /** Local date and time, "YYYY-MM-DDTHH:MM" */
  startAt: string
  endAt: string
  /** false: a trip over midnight without an overnight stay (one allowance at most) */
  overnight: boolean
  rates: { partialCents: number; fullCents: number }
  /** Provided meals by ISO date; days without an entry had none */
  meals: Record<string, TripMeals>
  /** Kilometres driven with an own vehicle */
  kilometres: number
  vehicle: Vehicle
}

export interface TripDay {
  date: string
  kind: TripDayKind
  /** Hours away on this day, rounded to minutes */
  hours: number
  allowanceCents: number
  deductionCents: number
  netCents: number
}

export interface TripAllowances {
  days: TripDay[]
  /** Hours from start to end */
  totalHours: number
  allowancesCents: number
  mileageCents: number
}

const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/
const MINUTE = 60_000

/** Minutes since the epoch of a local "YYYY-MM-DDTHH:MM", read as if it were UTC (no DST jumps) */
function minutesOf(value: string): number | null {
  const match = DATE_TIME.exec(value)
  if (!match) return null
  const ms = Date.parse(`${match[1]}T${match[2]}:${match[3]}:00Z`)
  return Number.isNaN(ms) ? null : ms / MINUTE
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Why the times cannot be calculated, null when they can */
export function tripTimesError(startAt: string, endAt: string): string | null {
  const start = minutesOf(startAt)
  const end = minutesOf(endAt)
  if (start === null || end === null) return 'Bitte Beginn und Ende mit Datum und Uhrzeit angeben'
  if (end <= start) return 'Das Ende muss nach dem Beginn liegen'
  if (end - start > 366 * 24 * 60) return 'Eine Reise dauert höchstens ein Jahr'
  return null
}

/** The calendar days of the trip with the hours away on each */
export function tripDays(startAt: string, endAt: string): Array<{ date: string; hours: number }> {
  if (tripTimesError(startAt, endAt)) return []
  const start = minutesOf(startAt)!
  const end = minutesOf(endAt)!
  const days: Array<{ date: string; hours: number }> = []
  for (let date = startAt.slice(0, 10); date <= endAt.slice(0, 10); date = addDays(date, 1)) {
    const dayStart = minutesOf(`${date}T00:00`)!
    const from = Math.max(start, dayStart)
    const to = Math.min(end, dayStart + 24 * 60)
    days.push({ date, hours: Math.round(to - from) / 60 })
  }
  return days
}

function deductionOf(meals: TripMeals | undefined, fullCents: number): number {
  if (!meals) return 0
  const breakfast = meals.breakfast ? Math.round(fullCents * 0.2) : 0
  const lunch = meals.lunch ? Math.round(fullCents * 0.4) : 0
  const dinner = meals.dinner ? Math.round(fullCents * 0.4) : 0
  return breakfast + lunch + dinner
}

export function mileageCents(kilometres: number, vehicle: Vehicle): number {
  if (!Number.isFinite(kilometres) || kilometres <= 0) return 0
  return Math.round(kilometres * MILEAGE_CENTS_PER_KM[vehicle])
}

/** The allowances of a trip; an empty result for times that cannot be calculated */
export function tripAllowances(input: TripInput): TripAllowances {
  const days = tripDays(input.startAt, input.endAt)
  const mileage = mileageCents(input.kilometres, input.vehicle)
  if (days.length === 0)
    return { days: [], totalHours: 0, allowancesCents: 0, mileageCents: mileage }
  const totalHours = days.reduce((sum, day) => sum + day.hours, 0)
  const { partialCents, fullCents } = input.rates

  const allowanceFor = (index: number): { kind: TripDayKind; cents: number } => {
    if (days.length === 1) {
      return { kind: 'single', cents: days[0].hours > 8 ? partialCents : 0 }
    }
    // Over midnight without an overnight stay: one allowance, on the day with more hours
    if (!input.overnight && days.length === 2) {
      const longer = days[0].hours >= days[1].hours ? 0 : 1
      return {
        kind: 'single',
        cents: index === longer && totalHours > 8 ? partialCents : 0
      }
    }
    if (index === 0) return { kind: 'arrival', cents: partialCents }
    if (index === days.length - 1) return { kind: 'departure', cents: partialCents }
    return { kind: 'full', cents: fullCents }
  }

  const result = days.map((day, index): TripDay => {
    const { kind, cents } = allowanceFor(index)
    const deduction = Math.min(cents, deductionOf(input.meals[day.date], fullCents))
    return {
      date: day.date,
      kind,
      hours: day.hours,
      allowanceCents: cents,
      deductionCents: deduction,
      netCents: cents - deduction
    }
  })
  return {
    days: result,
    totalHours: Math.round(totalHours * 60) / 60,
    allowancesCents: result.reduce((sum, day) => sum + day.netCents, 0),
    mileageCents: mileage
  }
}

export const TRIP_DAY_LABELS: Record<TripDayKind, string> = {
  single: 'Eintägig',
  arrival: 'Anreisetag',
  full: 'Ganzer Tag',
  departure: 'Abreisetag'
}
