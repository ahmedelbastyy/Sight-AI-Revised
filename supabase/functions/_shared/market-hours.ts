// =============================================================================
// Sight — Authoritative US Market Session Helper (Session 174)
// =============================================================================
// This is the SINGLE source of truth for "is the US regular market open right
// now?" across every server-side notification worker. It always operates in
// America/New_York (correctly handles EST/EDT transitions), knows the NYSE
// holiday calendar through 2030, and knows every published early-close day.
//
// Regular US equity session: 9:30 AM to 4:00 PM ET on weekdays that are not
// full-day holidays. On official early-close days the close is 1:00 PM ET.
// Weekends, full holidays, pre-market and after-hours are NEVER considered
// "open" for the purposes of Sight's notification system.
// =============================================================================

// NYSE full-day holidays (observed dates). When a holiday falls on Saturday it
// is observed the prior Friday; when it falls on Sunday it is observed the
// following Monday. Extend this table each fall for the following year.
const MARKET_HOLIDAYS: Record<number, string[]> = {
  2024: ['01-01','01-15','02-19','03-29','05-27','06-19','07-04','09-02','11-28','12-25'],
  2025: ['01-01','01-20','02-17','04-18','05-26','06-19','07-04','09-01','11-27','12-25'],
  2026: ['01-01','01-19','02-16','04-03','05-25','06-19','07-03','09-07','11-26','12-25'],
  2027: ['01-01','01-18','02-15','03-26','05-31','06-18','07-05','09-06','11-25','12-24'],
  2028: ['01-17','02-21','04-14','05-29','06-19','07-04','09-04','11-23','12-25'],
  2029: ['01-01','01-15','02-19','03-30','05-28','06-19','07-04','09-03','11-22','12-25'],
  2030: ['01-01','01-21','02-18','04-19','05-27','06-19','07-04','09-02','11-28','12-25'],
};

// Early close days close at 1:00 PM ET (13:00). Day-before Independence Day,
// day-after Thanksgiving, Christmas Eve.
const EARLY_CLOSE_DAYS: Record<number, string[]> = {
  2024: ['07-03','11-29','12-24'],
  2025: ['07-03','11-28','12-24'],
  2026: ['07-02','11-27','12-24'],
  2027: ['07-02','11-26','12-23'],
  2028: ['07-03','11-24','12-22'],
  2029: ['07-03','11-23','12-24'],
  2030: ['07-03','11-29','12-24'],
};

export interface NYTime {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  dayOfWeek: number; // 0=Sun … 6=Sat
  dateStr: string;   // "MM-DD"
  tradingDate: string; // "YYYY-MM-DD" — used as the idempotency partition key
}

export function getNYTime(date: Date = new Date()): NYTime {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  };
  const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '0';
  const year = parseInt(get('year'), 10);
  const month = parseInt(get('month'), 10);
  const day = parseInt(get('day'), 10);
  let hours = parseInt(get('hour'), 10);
  if (hours === 24) hours = 0;
  const minutes = parseInt(get('minute'), 10);
  // Day of week using a stable noon-ET anchor so it never flips across DST.
  const anchor = new Date(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T12:00:00`);
  const dayOfWeek = anchor.getDay();
  const dateStr = `${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const tradingDate = `${year}-${dateStr}`;
  return { year, month, day, hours, minutes, dayOfWeek, dateStr, tradingDate };
}

export function isMarketDay(date: Date = new Date()): boolean {
  const t = getNYTime(date);
  if (t.dayOfWeek === 0 || t.dayOfWeek === 6) return false;
  const holidays = MARKET_HOLIDAYS[t.year];
  if (holidays && holidays.includes(t.dateStr)) return false;
  return true;
}

export function isEarlyCloseDay(date: Date = new Date()): boolean {
  const t = getNYTime(date);
  const early = EARLY_CLOSE_DAYS[t.year];
  return !!(early && early.includes(t.dateStr));
}

// Regular session close minute in ET on the given date. 4:00 PM normally, or
// 1:00 PM on an official early-close day.
export function regularCloseMinuteET(date: Date = new Date()): number {
  return isEarlyCloseDay(date) ? 13 * 60 : 16 * 60;
}

export const REGULAR_OPEN_MINUTE_ET = 9 * 60 + 30;

/**
 * True iff `date` is a valid US market trading day AND currently within the
 * regular session window [09:30, close). Pre-market, after-hours, weekends,
 * and full-day holidays all return false.
 */
export function isRegularMarketOpen(date: Date = new Date()): boolean {
  if (!isMarketDay(date)) return false;
  const t = getNYTime(date);
  const now = t.hours * 60 + t.minutes;
  return now >= REGULAR_OPEN_MINUTE_ET && now < regularCloseMinuteET(date);
}

/**
 * True iff the given moment is exactly at or within `windowMinutes` after the
 * regular session's open (9:30 AM ET). Used by the market-events worker to
 * detect the "market just opened" event without firing hours later.
 */
export function isJustAfterOpen(date: Date = new Date(), windowMinutes: number = 5): boolean {
  if (!isMarketDay(date)) return false;
  const t = getNYTime(date);
  const now = t.hours * 60 + t.minutes;
  return now >= REGULAR_OPEN_MINUTE_ET && now < REGULAR_OPEN_MINUTE_ET + windowMinutes;
}

/**
 * True iff the given moment is exactly at or within `windowMinutes` after the
 * regular session's close. Used to detect the "market just closed" event.
 */
export function isJustAfterClose(date: Date = new Date(), windowMinutes: number = 5): boolean {
  if (!isMarketDay(date)) return false;
  const t = getNYTime(date);
  const now = t.hours * 60 + t.minutes;
  const close = regularCloseMinuteET(date);
  return now >= close && now < close + windowMinutes;
}

/**
 * The current trading date partition key (YYYY-MM-DD in ET). Used everywhere
 * we deduplicate per-user-per-day so daylight-saving transitions do not cause
 * a user to receive two "market open" pushes on the same calendar day.
 */
export function currentTradingDate(date: Date = new Date()): string {
  return getNYTime(date).tradingDate;
}

/**
 * Returns a human-readable label for the given ET session ("Open", "Pre-Market",
 * "After Hours", "Closed"). Convenience helper for logging / diagnostics; not
 * consulted by any gating logic.
 */
export function sessionLabel(date: Date = new Date()): 'OPEN' | 'PRE_MARKET' | 'AFTER_HOURS' | 'CLOSED' {
  if (!isMarketDay(date)) return 'CLOSED';
  const t = getNYTime(date);
  const now = t.hours * 60 + t.minutes;
  if (now < REGULAR_OPEN_MINUTE_ET && now >= 4 * 60) return 'PRE_MARKET';
  if (now >= REGULAR_OPEN_MINUTE_ET && now < regularCloseMinuteET(date)) return 'OPEN';
  if (now >= regularCloseMinuteET(date) && now < 20 * 60) return 'AFTER_HOURS';
  return 'CLOSED';
}
