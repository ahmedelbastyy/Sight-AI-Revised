import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { getSupabaseClient } from '@/template';

const NOTIFICATION_PREFS_KEY = 'ts_notification_prefs';

export interface NotificationPrefs {
  enabled: boolean;
  // Session 170 — breakoutAlerts REMOVED. Replaced with marketOpen.
  // Field kept in interface for backwards-compat reads only; always false.
  breakoutAlerts?: boolean;
  marketOpen: boolean;
  priceMovements: boolean;
  dailySummary: boolean;
  aiSignals: boolean;
  priceThreshold: number;
}

// Session 214 — priceMovements defaults to FALSE and is no longer
// user-toggleable. Retained in the interface for backward-compat with
// stored prefs so an old cached `true` value cannot crash reads.
export const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  breakoutAlerts: false,
  marketOpen: true,
  priceMovements: false,
  dailySummary: true,
  aiSignals: true,
  priceThreshold: 3,
};

// ===== US MARKET HOLIDAYS (NYSE/NASDAQ) =====
// These are the official NYSE observed holidays.
// When a holiday falls on Saturday, it is observed the prior Friday.
// When a holiday falls on Sunday, it is observed the following Monday.
const MARKET_HOLIDAYS: Record<number, string[]> = {
  2024: [
    '01-01', // New Year's Day
    '01-15', // MLK Day
    '02-19', // Presidents' Day
    '03-29', // Good Friday
    '05-27', // Memorial Day
    '06-19', // Juneteenth
    '07-04', // Independence Day
    '09-02', // Labor Day
    '11-28', // Thanksgiving
    '12-25', // Christmas
  ],
  2025: [
    '01-01', // New Year's Day
    '01-20', // MLK Day
    '02-17', // Presidents' Day
    '04-18', // Good Friday
    '05-26', // Memorial Day
    '06-19', // Juneteenth
    '07-04', // Independence Day
    '09-01', // Labor Day
    '11-27', // Thanksgiving
    '12-25', // Christmas
  ],
  2026: [
    '01-01', // New Year's Day
    '01-19', // MLK Day
    '02-16', // Presidents' Day
    '04-03', // Good Friday
    '05-25', // Memorial Day
    '06-19', // Juneteenth
    '07-03', // Independence Day (observed, July 4 is Saturday)
    '09-07', // Labor Day
    '11-26', // Thanksgiving
    '12-25', // Christmas
  ],
  2027: [
    '01-01', // New Year's Day
    '01-18', // MLK Day
    '02-15', // Presidents' Day
    '03-26', // Good Friday
    '05-31', // Memorial Day
    '06-18', // Juneteenth (observed, June 19 is Saturday)
    '07-05', // Independence Day (observed, July 4 is Sunday)
    '09-06', // Labor Day
    '11-25', // Thanksgiving
    '12-24', // Christmas (observed, Dec 25 is Saturday)
  ],
  2028: [
    '01-17', // MLK Day
    '02-21', // Presidents' Day
    '04-14', // Good Friday
    '05-29', // Memorial Day
    '06-19', // Juneteenth
    '07-04', // Independence Day
    '09-04', // Labor Day
    '11-23', // Thanksgiving
    '12-25', // Christmas
  ],
  2029: [
    '01-01', // New Year's Day
    '01-15', // MLK Day
    '02-19', // Presidents' Day
    '03-30', // Good Friday
    '05-28', // Memorial Day
    '06-19', // Juneteenth
    '07-04', // Independence Day
    '09-03', // Labor Day
    '11-22', // Thanksgiving
    '12-25', // Christmas
  ],
  2030: [
    '01-01', // New Year's Day
    '01-21', // MLK Day
    '02-18', // Presidents' Day
    '04-19', // Good Friday
    '05-27', // Memorial Day
    '06-19', // Juneteenth
    '07-04', // Independence Day
    '09-02', // Labor Day
    '11-28', // Thanksgiving
    '12-25', // Christmas
  ],
};

// Early close days (1 PM ET close) - day before Independence Day, day after Thanksgiving, Christmas Eve
// Not blocking trading, but useful for UI. We don't gate these but track them.
const EARLY_CLOSE_DAYS: Record<number, string[]> = {
  2025: ['07-03', '11-28', '12-24'],
  2026: ['07-02', '11-27', '12-24'],
  2027: ['07-02', '11-26', '12-23'],
  2028: ['07-03', '11-24', '12-22'],
  2029: ['07-03', '11-23', '12-24'],
  2030: ['07-03', '11-29', '12-24'],
};

/**
 * Get current date/time in US Eastern Time.
 * This ensures the app always operates on ET regardless of user's local timezone.
 */
export function getNYTime(date: Date = new Date()): { year: number; month: number; day: number; hours: number; minutes: number; dayOfWeek: number; dateStr: string } {
  // Use Intl to get accurate ET time (handles DST automatically)
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '0';

  const year = parseInt(get('year'), 10);
  const month = parseInt(get('month'), 10);
  const day = parseInt(get('day'), 10);
  let hours = parseInt(get('hour'), 10);
  // Intl may return 24 for midnight in hour24 mode
  if (hours === 24) hours = 0;
  const minutes = parseInt(get('minute'), 10);

  // Get day of week in ET
  const etDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00`;
  const etDate = new Date(etDateStr);
  const dayOfWeek = etDate.getDay(); // 0=Sun, 6=Sat

  const dateStr = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return { year, month, day, hours, minutes, dayOfWeek, dateStr };
}

/**
 * Check if the given date is a market trading day (not weekend, not holiday).
 * ALWAYS uses ET timezone regardless of user's location.
 */
export function isMarketDay(date: Date = new Date()): boolean {
  const et = getNYTime(date);

  // Weekend check
  if (et.dayOfWeek === 0 || et.dayOfWeek === 6) return false;

  // Holiday check
  const holidays = MARKET_HOLIDAYS[et.year];
  if (holidays && holidays.includes(et.dateStr)) return false;

  return true;
}

/**
 * Check if the market is currently in regular trading hours (9:30 AM - 4:00 PM ET).
 */
export function isMarketOpen(date: Date = new Date()): boolean {
  if (!isMarketDay(date)) return false;
  const et = getNYTime(date);
  const totalMinutes = et.hours * 60 + et.minutes;

  // Check early close days (close at 1 PM ET)
  const earlys = EARLY_CLOSE_DAYS[et.year];
  const isEarlyClose = earlys && earlys.includes(et.dateStr);
  const closeMinute = isEarlyClose ? 13 * 60 : 16 * 60; // 1 PM or 4 PM

  return totalMinutes >= 9 * 60 + 30 && totalMinutes < closeMinute;
}

/**
 * Check if market is in extended hours (pre-market 4 AM - 9:30 AM ET, after-hours 4 PM - 8 PM ET).
 */
export function isExtendedHours(date: Date = new Date()): boolean {
  if (!isMarketDay(date)) return false;
  const et = getNYTime(date);
  const totalMinutes = et.hours * 60 + et.minutes;
  // Pre-market: 4:00 AM - 9:30 AM
  if (totalMinutes >= 4 * 60 && totalMinutes < 9 * 60 + 30) return true;
  // After-hours: 4:00 PM - 8:00 PM
  if (totalMinutes >= 16 * 60 && totalMinutes < 20 * 60) return true;
  return false;
}

export type MarketSession = 'PRE_MARKET' | 'OPEN' | 'AFTER_HOURS' | 'CLOSED';

export interface MarketStatusInfo {
  session: MarketSession;
  label: string;
  nextOpen: Date | null;
  isHoliday: boolean;
  holidayName?: string;
}

// Holiday names for display
const HOLIDAY_NAMES: Record<string, string> = {
  '01-01': "New Year's Day",
  '01-15': 'Martin Luther King Jr. Day',
  '01-17': 'Martin Luther King Jr. Day',
  '01-18': 'Martin Luther King Jr. Day',
  '01-19': 'Martin Luther King Jr. Day',
  '01-20': 'Martin Luther King Jr. Day',
  '01-21': 'Martin Luther King Jr. Day',
  '02-15': "Presidents' Day",
  '02-16': "Presidents' Day",
  '02-17': "Presidents' Day",
  '02-18': "Presidents' Day",
  '02-19': "Presidents' Day",
  '02-21': "Presidents' Day",
  '03-26': 'Good Friday',
  '03-29': 'Good Friday',
  '03-30': 'Good Friday',
  '04-03': 'Good Friday',
  '04-14': 'Good Friday',
  '04-18': 'Good Friday',
  '04-19': 'Good Friday',
  '05-25': 'Memorial Day',
  '05-26': 'Memorial Day',
  '05-27': 'Memorial Day',
  '05-28': 'Memorial Day',
  '05-29': 'Memorial Day',
  '05-31': 'Memorial Day',
  '06-18': 'Juneteenth',
  '06-19': 'Juneteenth',
  '07-02': 'Independence Day (Observed)',
  '07-03': 'Independence Day (Observed)',
  '07-04': 'Independence Day',
  '07-05': 'Independence Day (Observed)',
  '09-01': 'Labor Day',
  '09-02': 'Labor Day',
  '09-03': 'Labor Day',
  '09-04': 'Labor Day',
  '09-06': 'Labor Day',
  '09-07': 'Labor Day',
  '11-22': 'Thanksgiving',
  '11-23': 'Thanksgiving',
  '11-24': 'Thanksgiving',
  '11-25': 'Thanksgiving',
  '11-26': 'Thanksgiving',
  '11-27': 'Thanksgiving',
  '11-28': 'Thanksgiving',
  '12-22': 'Christmas (Observed)',
  '12-23': 'Christmas (Observed)',
  '12-24': 'Christmas (Observed)',
  '12-25': 'Christmas',
};

/**
 * Get next market open date/time in UTC.
 * Searches forward from the given date to find the next valid trading day.
 */
export function getNextMarketOpenUTC(from: Date = new Date()): Date {
  const et = getNYTime(from);
  const totalMinutes = et.hours * 60 + et.minutes;

  // If market is currently open, next open is now (or rather, it's already open)
  if (isMarketDay(from) && totalMinutes >= 9 * 60 + 30 && totalMinutes < 16 * 60) {
    return from; // Already open
  }

  // If it's a market day and before open, next open is today at 9:30 AM ET
  if (isMarketDay(from) && totalMinutes < 9 * 60 + 30) {
    // Calculate 9:30 AM ET in UTC
    return getETDateInUTC(et.year, et.month, et.day, 9, 30);
  }

  // Otherwise search for the next market day
  // Start from tomorrow (in ET)
  let searchDate = new Date(from.getTime());
  for (let i = 0; i < 14; i++) {
    searchDate = new Date(searchDate.getTime() + 24 * 60 * 60 * 1000);
    if (isMarketDay(searchDate)) {
      const nextET = getNYTime(searchDate);
      return getETDateInUTC(nextET.year, nextET.month, nextET.day, 9, 30);
    }
  }

  // Fallback: return next Monday 9:30 AM ET
  const daysUntilMonday = et.dayOfWeek === 0 ? 1 : 8 - et.dayOfWeek;
  searchDate = new Date(from.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000);
  const mondayET = getNYTime(searchDate);
  return getETDateInUTC(mondayET.year, mondayET.month, mondayET.day, 9, 30);
}

/**
 * Convert an ET time to a UTC Date object.
 */
function getETDateInUTC(year: number, month: number, day: number, hours: number, minutes: number): Date {
  // Create a date string in ET and let the system convert
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
  
  // Use a known approach: create date in UTC, then adjust for ET offset
  // ET is UTC-5 (EST) or UTC-4 (EDT). We can determine which by checking the offset for this date.
  const tempDate = new Date(`${dateStr}-05:00`); // Assume EST first
  const checkET = getNYTime(tempDate);
  
  // If the hours match, we got the right offset. If not, try EDT.
  if (checkET.hours === hours && checkET.minutes === minutes) {
    return tempDate;
  }
  
  // Try EDT (UTC-4)
  return new Date(`${dateStr}-04:00`);
}

/**
 * Get comprehensive market status with holiday detection.
 */
export function getMarketStatus(date: Date = new Date()): MarketStatusInfo {
  const et = getNYTime(date);
  const totalMinutes = et.hours * 60 + et.minutes;

  // Check if today is a holiday
  const holidays = MARKET_HOLIDAYS[et.year];
  const isHoliday = holidays ? holidays.includes(et.dateStr) : false;
  const holidayName = isHoliday ? HOLIDAY_NAMES[et.dateStr] : undefined;

  // Weekend
  if (et.dayOfWeek === 0 || et.dayOfWeek === 6) {
    return {
      session: 'CLOSED',
      label: 'Market Closed',
      nextOpen: getNextMarketOpenUTC(date),
      isHoliday: false,
    };
  }

  // Holiday
  if (isHoliday) {
    return {
      session: 'CLOSED',
      label: holidayName ? `Closed for ${holidayName}` : 'Market Closed (Holiday)',
      nextOpen: getNextMarketOpenUTC(date),
      isHoliday: true,
      holidayName,
    };
  }

  // Early close check
  const earlys = EARLY_CLOSE_DAYS[et.year];
  const isEarlyClose = earlys && earlys.includes(et.dateStr);
  const closeMinute = isEarlyClose ? 13 * 60 : 16 * 60;

  // Pre-market: 4:00 AM - 9:30 AM ET
  if (totalMinutes >= 4 * 60 && totalMinutes < 9 * 60 + 30) {
    return {
      session: 'PRE_MARKET',
      label: 'Pre-Market',
      nextOpen: getETDateInUTC(et.year, et.month, et.day, 9, 30),
      isHoliday: false,
    };
  }

  // Market open: 9:30 AM - close (4 PM or 1 PM on early close)
  if (totalMinutes >= 9 * 60 + 30 && totalMinutes < closeMinute) {
    return {
      session: 'OPEN',
      label: isEarlyClose ? 'Market Open (Early Close)' : 'Market Open',
      nextOpen: null,
      isHoliday: false,
    };
  }

  // After-hours: close - 8 PM ET
  if (totalMinutes >= closeMinute && totalMinutes < 20 * 60) {
    return {
      session: 'AFTER_HOURS',
      label: 'After Hours',
      nextOpen: getNextMarketOpenUTC(date),
      isHoliday: false,
    };
  }

  // Closed (before 4 AM or after 8 PM)
  return {
    session: 'CLOSED',
    label: 'Market Closed',
    nextOpen: getNextMarketOpenUTC(date),
    isHoliday: false,
  };
}

export function getNextMarketDay(from: Date = new Date()): Date {
  const next = new Date(from);
  next.setDate(next.getDate() + 1);
  let attempts = 0;
  while (!isMarketDay(next) && attempts < 14) {
    next.setDate(next.getDate() + 1);
    attempts++;
  }
  return next;
}

// Session 175 — defensive module initialization. The prior version called
// Notifications.setNotificationHandler({...}) and setNotificationCategoryAsync()
// synchronously at module top level. In some installed expo-notifications
// versions AndroidNotificationPriority.MAX / setNotificationCategoryAsync
// have been renamed or removed, which threw a TypeError during import and
// crashed the entire app on launch (this file is imported by AppContext,
// so its module load failure propagates through the whole tree). Wrapping
// every top-level side-effect in try/catch guarantees a missing API can
// never prevent the app from starting.
try {
  const anyNotif: any = Notifications as any;
  const priorityMax =
    anyNotif?.AndroidNotificationPriority?.MAX ??
    anyNotif?.AndroidImportance?.MAX ??
    undefined;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
      ...(priorityMax !== undefined ? { priority: priorityMax } : {}),
    }),
  } as any);
} catch (e) { console.log('[NOTIF] setNotificationHandler failed (non-fatal):', e); }

try {
  if (Platform.OS !== 'web' && typeof (Notifications as any).setNotificationCategoryAsync === 'function') {
    (Notifications as any).setNotificationCategoryAsync('daily_summary', []).catch(() => {});
    (Notifications as any).setNotificationCategoryAsync('ai_signal', []).catch(() => {});
    (Notifications as any).setNotificationCategoryAsync('price_alert', []).catch(() => {});
  }
} catch (e) { console.log('[NOTIF] setNotificationCategoryAsync failed (non-fatal):', e); }

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
        allowCriticalAlerts: false,
        allowProvisional: false,
      },
    });
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[NOTIF] Permission denied. Status:', finalStatus);
    return false;
  }

  console.log('[NOTIF] Permission granted');

  // Register for push token (needed for remote push via Expo Push Service)
  // Note: TestFlight uses PRODUCTION APNs environment, not sandbox.
  // Expo Push Service handles this automatically when using getExpoPushTokenAsync.
  try {
    // Resolve projectId from EAS config explicitly for reliability across builds
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId ??
      undefined;

    const tokenArgs: any = projectId ? { projectId } : {};
    const token = await Notifications.getExpoPushTokenAsync(tokenArgs);
    await AsyncStorage.setItem('ts_push_token', token.data);
    // Session 190 — Redact the push token in production logs so full
    // Expo push tokens never appear in third-party log collectors. The
    // full token is still stored in AsyncStorage for backend registration.
    if (__DEV__) {
      console.log('[NOTIF] Push token registered:', token.data);
    } else {
      const t = String(token.data || '');
      const redacted = t.length > 12 ? `${t.slice(0, 6)}…${t.slice(-4)}` : 'ExponentPushToken[redacted]';
      console.log('[NOTIF] Push token registered (redacted):', redacted);
    }
    console.log('[NOTIF] Note: This token works with PRODUCTION APNs (required for TestFlight)');

    // Associate this device's Expo push token with the currently signed-in
    // user in the backend so the send-push-notification edge function can
    // deliver push notifications even when the app is closed. No-op if the
    // user is signed out — AppContext will re-attempt registration on next
    // login using the token we just stored in AsyncStorage.
    try {
      const supabase = getSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        registerPushTokenToBackend(session.user.id, { token: token.data }).catch(() => {});
      }
    } catch {}
  } catch (e) {
    // Push token not critical for local notifications
    console.log('[NOTIF] Push token registration skipped (local notifications still work):', e);
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('breakout-alerts', {
      name: 'Breakout Alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#3B82F6',
      sound: 'default',
    });
    await Notifications.setNotificationChannelAsync('price-alerts', {
      name: 'Price Movement Alerts',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
    await Notifications.setNotificationChannelAsync('daily-summary', {
      name: 'Daily Market Summary',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
    await Notifications.setNotificationChannelAsync('ai-signals', {
      name: 'AI Trading Signals',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#10B981',
      sound: 'default',
    });
    await Notifications.setNotificationChannelAsync('market-open', {
      name: 'Market Open Alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#10B981',
      sound: 'default',
    });
  }

  return true;
}

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  try {
    const saved = await AsyncStorage.getItem(NOTIFICATION_PREFS_KEY);
    if (saved) return { ...DEFAULT_PREFS, ...JSON.parse(saved) };
    return DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function saveNotificationPrefs(prefs: NotificationPrefs): Promise<void> {
  await AsyncStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(prefs));
  // Session 170 — sync to backend so the send-push-notification edge
  // function can honor category toggles server-side. Fire-and-forget;
  // local prefs are the source of truth for foreground UI, backend prefs
  // only gate outbound push delivery.
  try {
    const supabase = getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) {
      await supabase
        .from('user_profiles')
        .update({ notif_prefs: prefs })
        .eq('id', session.user.id);
    }
  } catch { /* non-fatal — local prefs already saved */ }
}

// Check if device has granted notification permissions
async function isDevicePermissionGranted(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

// Session 170 — sendBreakoutAlert is now a NO-OP. Breakout Alerts have
// been permanently removed from the app. The signature is kept so any
// legacy call site cannot crash the build; callers should be migrated
// to sendMarketOpenNotification instead.
export async function sendBreakoutAlert(_ticker: string, _type: string, _description: string, _confidence: number) {
  // Intentionally empty — Breakout Alerts have been discontinued.
  return;
}

// Track which stocks have already sent a price alert this session to avoid spam
const priceAlertSentThisSession = new Map<string, number>();

// Session 214 — Price Movement Alerts have been PERMANENTLY DISABLED
// per user request. This function is now a no-op so any legacy caller
// (AppContext.refreshStocks + price-alerts-worker Edge Function) cannot
// accidentally fire a notification. The signature is preserved so
// removing every callsite is not required. Users no longer see the
// Price Movements toggle in the Notifications screen and the threshold
// selector has been removed entirely.
export async function sendPriceAlert(_ticker: string, _price: number, _changePercent: number, _direction: 'up' | 'down') {
  return;
}

// The remainder of the historic sendPriceAlert body has been REMOVED.
// (Session 214 — dead code removed to keep the module readable.)

// Reset price alert tracking (call at market open)
export function resetPriceAlertTracking() {
  priceAlertSentThisSession.clear();
}

// Track AI signals already sent to avoid re-sending same signal
const aiSignalSentThisSession = new Map<string, string>();

export async function sendAISignalAlert(ticker: string, signal: 'BUY' | 'SELL' | 'HOLD', confidence: number, reasoning: string) {
  const prefs = await getNotificationPrefs();
  if (!prefs.enabled || !prefs.aiSignals) {
    console.log('[NOTIF] AI signal skipped: prefs disabled');
    return;
  }
  if (!isMarketOpen()) {
    console.log('[NOTIF] AI signal skipped: market not open');
    return;
  }
  if (!(await isDevicePermissionGranted())) {
    console.log('[NOTIF] AI signal skipped: device permission not granted');
    return;
  }
  // Only notify for very high-confidence BUY or SELL signals (90%+ threshold)
  if (signal === 'HOLD') return;
  if (confidence < 90) return;

  // Don't re-send the same signal for the same stock
  const lastSignal = aiSignalSentThisSession.get(ticker);
  if (lastSignal === signal) return;
  aiSignalSentThisSession.set(ticker, signal);

  const icon = signal === 'BUY' ? '\uD83D\uDFE2' : '\uD83D\uDD34';
  const action = signal === 'BUY' ? 'Buy' : 'Sell';
  const potential = signal === 'BUY'
    ? `Strong upside potential detected with ${confidence}% AI confidence.`
    : `Downside risk identified with ${confidence}% AI confidence.`;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${icon} ${action} Signal: ${ticker}`,
        body: `${potential} ${reasoning}`,
        data: { type: 'ai_signal', ticker, signal },
        sound: 'default',
        badge: 1,
        ...(Platform.OS === 'android' ? { channelId: 'ai-signals' } : {}),
      },
      trigger: null,
    });
    console.log('[NOTIF] AI signal alert SENT for', ticker, signal, 'confidence:', confidence);
  } catch (e) {
    console.log('[NOTIF] FAILED to send AI signal alert:', e);
  }
}

// Reset AI signal tracking (call at market open)
export function resetAISignalTracking() {
  aiSignalSentThisSession.clear();
}

export async function sendMarketOpenNotification(portfolioValue?: number) {
  const prefs = await getNotificationPrefs();
  if (!prefs.enabled) return;
  // Session 170 — respect the new marketOpen toggle. Users can opt out
  // of market-open notifications independently of other alerts.
  if (prefs.marketOpen === false) return;
  if (!isMarketDay()) return;
  if (!(await isDevicePermissionGranted())) return;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Stock Market is Now Open \uD83D\uDD14',
        body: portfolioValue
          ? `Your portfolio is worth $${portfolioValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}. Check your AI signals for today.`
          : 'Check your watchlist and AI signals for today.',
        data: { type: 'market_open' },
        sound: 'default',
        ...(Platform.OS === 'android' ? { channelId: 'market-open' } : {}),
      },
      trigger: null,
    });
    console.log('[NOTIF] Market open notification sent');
  } catch (e) {
    console.log('[NOTIF] Failed to send market open notification:', e);
  }
}

// Session 189 — helper: convert (ET year, month, day, minuteOfDay) to a JS
// Date whose absolute UTC instant corresponds to that ET wall-clock. Handles
// both EDT (-04:00) and EST (-05:00) automatically. Used by every market-
// scheduled local notification below so the notifications actually fire at
// the correct America/New_York moment regardless of the user's device TZ.
function etMinuteToLocalDate(year: number, month: number, day: number, minuteOfDay: number): Date {
  const hh = Math.floor(minuteOfDay / 60);
  const mm = minuteOfDay % 60;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
  const asEdt = new Date(`${iso}-04:00`);
  try {
    const check = getNYTime(asEdt);
    if (check.hours * 60 + check.minutes === minuteOfDay && check.day === day && check.month === month && check.year === year) {
      return asEdt;
    }
  } catch { /* fall through to EST */ }
  return new Date(`${iso}-05:00`);
}

function isEarlyCloseDay(date: Date): boolean {
  try {
    const et = getNYTime(date);
    const earlys = EARLY_CLOSE_DAYS[et.year];
    return !!(earlys && earlys.includes(et.dateStr));
  } catch { return false; }
}

// =============================================================================
// Session 191 — MARKET OPEN / CLOSE ROLLING WINDOW.
//
// PRIOR ROOT-CAUSE FAILURE:
//   The previous implementation used two CONSTANT identifiers
//   ('market-open-daily' / 'market-close-daily') and only scheduled a
//   SINGLE next-trading-day notification at a time. Because iOS delivers
//   scheduled DATE-trigger notifications by identifier, every call to
//   scheduleMarketOpenNotification cancelled the previously-scheduled
//   entry and only kept the very next day. If the user did not
//   foreground the app between Monday and Wednesday, Wednesday's open /
//   close notifications never got scheduled at all. Additionally, the
//   close notification shared its constant identifier with the OPEN
//   notification's callers (both were cancelled together by
//   cancelMarketOpenClose) so they could not coexist reliably.
//
// FIX:
//   Schedule a ROLLING WINDOW of the next `daysAhead` U.S. trading days.
//   Each day gets DATE-SPECIFIC identifiers  `market-open-YYYY-MM-DD`
//   and `market-close-YYYY-MM-DD` — so open and close never share IDs
//   and future days are not overwritten. Scheduled IDs are persisted per
//   date in AsyncStorage so cancellation can reliably remove every ID
//   later. On every reconcile pass we PURGE past-date entries and only
//   schedule days that don't yet have an ID — so re-running reconcile is
//   idempotent and does not create duplicates. Handles early-close days
//   correctly by picking that date's actual 13:00 ET close time.
//
// PENDING-COUNT BUDGET (safely under iOS's 64 pending-notification cap):
//   Daily Summary          →  1 (DAILY trigger; one slot)
//   AI Moves reminders     → 30 (3 × 10 rolling trading days)
//   Market Open / Close    → 28 (2 × 14 rolling trading days)
//   TOTAL                  ≈ 59 slots (headroom: 5 slots).
// =============================================================================
const MARKET_OC_SCHEDULE_KEY = 'ts_market_open_close_schedule_v1';

interface MarketOCEntry {
  open_id?: string;
  close_id?: string;
  close_minute?: number;
}

async function readMarketOCSchedule(): Promise<Record<string, MarketOCEntry>> {
  try {
    const raw = await AsyncStorage.getItem(MARKET_OC_SCHEDULE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

async function writeMarketOCSchedule(schedule: Record<string, MarketOCEntry>): Promise<void> {
  try { await AsyncStorage.setItem(MARKET_OC_SCHEDULE_KEY, JSON.stringify(schedule)); } catch { /* swallow */ }
}

export async function scheduleMarketOpenClose(daysAhead: number = 14): Promise<void> {
  if (Platform.OS === 'web') return;
  const prefs = await getNotificationPrefs();
  if (!prefs.enabled || prefs.marketOpen === false) {
    await cancelMarketOpenClose();
    return;
  }
  if (!(await isDevicePermissionGranted())) {
    await cancelMarketOpenClose();
    return;
  }

  // Legacy cleanup — cancel the old constant-ID scheduled notifications
  // left over from prior versions so they cannot coexist with the new
  // date-specific IDs.
  await Notifications.cancelScheduledNotificationAsync('market-open-daily').catch(() => {});
  await Notifications.cancelScheduledNotificationAsync('market-close-daily').catch(() => {});

  const schedule = await readMarketOCSchedule();
  const now = new Date();
  const nowMs = now.getTime();
  const nowEt = getNYTime(now);

  // Purge past-day entries (their pending IDs have already fired or been
  // dropped by iOS at their scheduled time).
  for (const key of Object.keys(schedule)) {
    const parts = key.split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) { delete schedule[key]; continue; }
    const [y, m, d] = parts;
    const isPast =
      y < nowEt.year ||
      (y === nowEt.year && m < nowEt.month) ||
      (y === nowEt.year && m === nowEt.month && d < nowEt.day);
    if (isPast) {
      const entry = schedule[key];
      await cancelIdSafe(entry.open_id);
      await cancelIdSafe(entry.close_id);
      delete schedule[key];
    }
  }

  let cursor = new Date(now);
  let scheduledDays = 0;
  for (let iter = 0; iter < 40 && scheduledDays < daysAhead; iter++) {
    if (!isMarketDay(cursor)) {
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
      continue;
    }
    const et = getNYTime(cursor);
    const key = `${et.year}-${String(et.month).padStart(2, '0')}-${String(et.day).padStart(2, '0')}`;
    const isEarly = isEarlyCloseDay(cursor);
    const closeMinute = isEarly ? 13 * 60 : 16 * 60;
    const entry: MarketOCEntry = schedule[key] ?? {};
    entry.close_minute = closeMinute;

    // Schedule OPEN (9:30 ET) if not already scheduled and still future.
    if (!entry.open_id) {
      const when = etMinuteToLocalDate(et.year, et.month, et.day, 9 * 60 + 30);
      if (when.getTime() > nowMs + 1000) {
        const id = `market-open-${key}`;
        try {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: 'Stock Market is Now Open \uD83D\uDD14',
              body: 'Check your portfolio and AI signals for personalized insights!',
              data: { type: 'market_open', tradingDate: key },
              sound: 'default',
              ...(Platform.OS === 'android' ? { channelId: 'market-open' } : {}),
            },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
            identifier: id,
          });
          entry.open_id = id;
          if (__DEV__) console.log('[NOTIF] scheduled market-open', key, 'at', when.toISOString());
        } catch (e) {
          console.log('[NOTIF] market-open schedule failed', key, e);
        }
      }
    }

    // Schedule CLOSE (16:00 ET normal, 13:00 ET on early-close days) if
    // not already scheduled and still future.
    if (!entry.close_id) {
      const when = etMinuteToLocalDate(et.year, et.month, et.day, closeMinute);
      if (when.getTime() > nowMs + 1000) {
        const id = `market-close-${key}`;
        try {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: 'Stock Market Now Closed \uD83D\uDD12',
              body: isEarly
                ? 'The US market has closed early today. Review your trades and Journal.'
                : 'The regular US market session has ended. Review your trades and Journal.',
              data: { type: 'market_close', earlyClose: isEarly, tradingDate: key },
              sound: 'default',
              ...(Platform.OS === 'android' ? { channelId: 'market-open' } : {}),
            },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
            identifier: id,
          });
          entry.close_id = id;
          if (__DEV__) console.log('[NOTIF] scheduled market-close', key, 'at', when.toISOString(), 'earlyClose=', isEarly);
        } catch (e) {
          console.log('[NOTIF] market-close schedule failed', key, e);
        }
      }
    }

    schedule[key] = entry;
    scheduledDays++;
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  await writeMarketOCSchedule(schedule);
  console.log('[NOTIF] Market Open/Close scheduled across', Object.keys(schedule).length, 'trading days');
}

export async function cancelMarketOpenClose(): Promise<void> {
  const schedule = await readMarketOCSchedule();
  for (const key of Object.keys(schedule)) {
    const entry = schedule[key];
    await cancelIdSafe(entry.open_id);
    await cancelIdSafe(entry.close_id);
  }
  await writeMarketOCSchedule({});
  // Legacy constant-ID cleanup (safe no-op if already cancelled).
  await Notifications.cancelScheduledNotificationAsync('market-open-daily').catch(() => {});
  await Notifications.cancelScheduledNotificationAsync('market-close-daily').catch(() => {});
  console.log('[NOTIF] Market Open/Close reminders cancelled');
}

// Backwards-compat: legacy call-sites (AppContext.refreshStocks +
// notifications.tsx toggle handlers) still invoke these two functions by
// name. Both now delegate to the single rolling-window scheduler so no
// call site needs updating and there is exactly ONE source of truth for
// the market open/close schedule.
export async function scheduleMarketOpenNotification(): Promise<void> {
  return scheduleMarketOpenClose(14);
}
export async function scheduleMarketCloseNotification(): Promise<void> {
  return scheduleMarketOpenClose(14);
}

// =============================================================================
// Session 189 — LOCAL AI MOVES REMINDERS.
//
// Three generic engagement reminders per U.S. market trading day, delivered
// via expo-notifications DATE triggers so iOS can fire them even while Sight
// is fully closed — the same mechanism the working Daily Summary and Market
// Open notifications use.
//
// SCHEDULE (America/New_York):
//   Reminder #1 → RANDOM minute in [10:00, 10:59] ET
//   Reminder #2 → RANDOM minute in [12:00, 12:59] ET (upper bound clamped to
//                 closeMinute - 1 on early close days)
//   Reminder #3 → EXACTLY 15:00 ET — skipped on early-close days (13:00 close).
//
// STABILITY:
//   Random minutes are generated ONCE per trading date and persisted in
//   AsyncStorage under AI_MOVES_SCHEDULE_KEY. Subsequent app launches /
//   reconcile calls REUSE those minutes so a user always sees the same
//   pattern on a given day.
//
// PREF CONTROL:
//   • prefs.enabled === false  → cancel all pending IDs.
//   • prefs.aiSignals === false → cancel all pending IDs.
//   • iOS permission not granted → cancel all pending IDs.
//
// EXPIRATION / EXTENSION:
//   Every call schedules the NEXT `daysAhead` trading days. Older date
//   entries whose ET calendar day is already past are purged (their pending
//   IDs are cancelled, though iOS will normally have already fired or
//   dropped them). Called from AppContext on startup + AppState=active +
//   after login so the future window stays populated even if the app is
//   only opened occasionally.
// =============================================================================
const AI_MOVES_SCHEDULE_KEY = 'ts_ai_moves_reminders_schedule_v1';

interface AIMovesScheduleEntry {
  reminder1_minute?: number;
  reminder2_minute?: number;
  reminder1_id?: string;
  reminder2_id?: string;
  reminder3_id?: string;
}

async function readAIMovesSchedule(): Promise<Record<string, AIMovesScheduleEntry>> {
  try {
    const raw = await AsyncStorage.getItem(AI_MOVES_SCHEDULE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

async function writeAIMovesSchedule(schedule: Record<string, AIMovesScheduleEntry>): Promise<void> {
  try { await AsyncStorage.setItem(AI_MOVES_SCHEDULE_KEY, JSON.stringify(schedule)); } catch { /* swallow */ }
}

async function cancelIdSafe(id?: string): Promise<void> {
  if (!id) return;
  try { await Notifications.cancelScheduledNotificationAsync(id); } catch { /* swallow */ }
}

export async function cancelAIMovesReminders(): Promise<void> {
  const schedule = await readAIMovesSchedule();
  for (const key of Object.keys(schedule)) {
    const entry = schedule[key];
    await cancelIdSafe(entry.reminder1_id);
    await cancelIdSafe(entry.reminder2_id);
    await cancelIdSafe(entry.reminder3_id);
  }
  await writeAIMovesSchedule({});
  console.log('[NOTIF] AI Moves reminders cancelled');
}

export async function scheduleAIMovesReminders(daysAhead: number = 7): Promise<void> {
  if (Platform.OS === 'web') return;
  const prefs = await getNotificationPrefs();
  if (!prefs.enabled || !prefs.aiSignals) {
    await cancelAIMovesReminders();
    return;
  }
  if (!(await isDevicePermissionGranted())) {
    await cancelAIMovesReminders();
    return;
  }

  const schedule = await readAIMovesSchedule();
  const now = new Date();
  const nowMs = now.getTime();
  const nowEt = getNYTime(now);

  // Purge past days from the schedule (cancel their pending IDs first).
  for (const key of Object.keys(schedule)) {
    const parts = key.split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) { delete schedule[key]; continue; }
    const [y, m, d] = parts;
    const isPastDay =
      y < nowEt.year ||
      (y === nowEt.year && m < nowEt.month) ||
      (y === nowEt.year && m === nowEt.month && d < nowEt.day);
    if (isPastDay) {
      const entry = schedule[key];
      await cancelIdSafe(entry.reminder1_id);
      await cancelIdSafe(entry.reminder2_id);
      await cancelIdSafe(entry.reminder3_id);
      delete schedule[key];
    }
  }

  // Walk forward until we've scheduled `daysAhead` real trading days
  // (capped at 30 calendar iterations to avoid infinite loops around
  // holiday weeks).
  let cursor = new Date(now);
  let scheduledDays = 0;
  for (let iter = 0; iter < 30 && scheduledDays < daysAhead; iter++) {
    if (!isMarketDay(cursor)) {
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
      continue;
    }
    const et = getNYTime(cursor);
    const key = `${et.year}-${String(et.month).padStart(2, '0')}-${String(et.day).padStart(2, '0')}`;
    const isEarly = isEarlyCloseDay(cursor);
    const closeMinute = isEarly ? 13 * 60 : 16 * 60;
    const entry: AIMovesScheduleEntry = schedule[key] ?? {};

    // Persistent random minutes — generated once per date and reused.
    if (entry.reminder1_minute == null) {
      entry.reminder1_minute = 10 * 60 + Math.floor(Math.random() * 60); // 10:00-10:59
    }
    if (entry.reminder2_minute == null) {
      const w2Upper = Math.min(13 * 60, closeMinute); // strict upper bound
      if (w2Upper > 12 * 60) {
        entry.reminder2_minute = 12 * 60 + Math.floor(Math.random() * Math.max(1, w2Upper - 12 * 60));
      }
    }

    const r1Date = etMinuteToLocalDate(et.year, et.month, et.day, entry.reminder1_minute!);
    const r2Date = entry.reminder2_minute != null
      ? etMinuteToLocalDate(et.year, et.month, et.day, entry.reminder2_minute)
      : null;
    const r3Date = (15 * 60) < closeMinute
      ? etMinuteToLocalDate(et.year, et.month, et.day, 15 * 60)
      : null;

    const scheduleOne = async (
      slot: 'reminder1' | 'reminder2' | 'reminder3',
      when: Date | null,
      minute: number | undefined,
    ) => {
      if (!when) return;
      if (when.getTime() <= nowMs + 1000) return; // already past — skip
      if (minute != null && minute >= closeMinute) return; // safety guard
      const idKey = `${slot}_id` as const;
      if (entry[idKey]) return; // already scheduled
      const id = `ai-moves-${slot}-${key}`;
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'AI Moves',
            body: 'Check your AI Moves now',
            data: { type: 'ai_reminder', tab: 'moves', tradingDate: key, slot },
            sound: 'default',
            badge: 1,
            ...(Platform.OS === 'android' ? { channelId: 'ai-signals' } : {}),
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
          identifier: id,
        });
        (entry as any)[idKey] = id;
      } catch (e) {
        console.log('[NOTIF] AI Moves schedule failed', slot, key, e);
      }
    };

    await scheduleOne('reminder1', r1Date, entry.reminder1_minute);
    await scheduleOne('reminder2', r2Date, entry.reminder2_minute);
    await scheduleOne('reminder3', r3Date, 15 * 60);

    schedule[key] = entry;
    scheduledDays++;
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  await writeAIMovesSchedule(schedule);
  console.log('[NOTIF] AI Moves reminders scheduled for', Object.keys(schedule).length, 'trading days');
}

// =============================================================================
// Session 189 — RECONCILE. Called on authenticated app startup and every
// AppState=active. Reads OS permission and current prefs, then repairs the
// scheduled-notification set so every category that SHOULD be pending is,
// and no category that SHOULDN'T be pending survives.
//
// Idempotent — uses each category's own schedule/cancel functions which
// themselves compare desired vs. actual state before writing.
// =============================================================================
export async function reconcileNotifications(portfolioValue?: number, watchlistTickers?: string[]): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const permGranted = await isDevicePermissionGranted();
    if (!permGranted) {
      // Revoked externally — wipe every Sight-owned schedule so a later
      // permission grant cannot deliver a backlog.
      try {
        await Notifications.cancelScheduledNotificationAsync('daily-summary').catch(() => {});
        await Notifications.cancelScheduledNotificationAsync('market-open-daily').catch(() => {});
        await Notifications.cancelScheduledNotificationAsync('market-close-daily').catch(() => {});
      } catch { /* swallow */ }
      await cancelAIMovesReminders();
      return;
    }

    const prefs = await getNotificationPrefs();
    if (!prefs.enabled) {
      await cancelAllNotifications();
      await writeAIMovesSchedule({});
      return;
    }

    // Daily summary
    if (prefs.dailySummary) {
      await scheduleDailySummary(watchlistTickers, portfolioValue);
    } else {
      await cancelDailySummary();
    }

    // Market Open / Close (single category, date-specific IDs, rolling
    // 14-trading-day window). Idempotent — re-invoking on every foreground
    // only fills in days that are not yet scheduled and purges past-date
    // entries.
    if (prefs.marketOpen !== false) {
      await scheduleMarketOpenClose(14);
    } else {
      await cancelMarketOpenClose();
    }

    // AI Moves generic reminders (3 per trading day, rolling 10 trading
    // days = up to 30 slots). Random minutes are generated once per date
    // and persisted so re-invocations do NOT re-randomize existing days.
    if (prefs.aiSignals) {
      await scheduleAIMovesReminders(10);
    } else {
      await cancelAIMovesReminders();
    }
  } catch (e) {
    console.log('[NOTIF] reconcileNotifications failed (non-fatal):', e);
  }
}

export async function scheduleDailySummary(watchlistTickers?: string[], portfolioValue?: number) {
  const prefs = await getNotificationPrefs();
  if (!prefs.enabled || !prefs.dailySummary) {
    console.log('[NOTIF] Daily summary not scheduled: enabled=', prefs.enabled, 'dailySummary=', prefs.dailySummary);
    return;
  }
  if (!(await isDevicePermissionGranted())) {
    console.log('[NOTIF] Daily summary not scheduled: device permission not granted');
    return;
  }

  await cancelDailySummary();

  const hasStocks = watchlistTickers && watchlistTickers.length > 0;
  const hasValue = typeof portfolioValue === 'number' && portfolioValue > 0;

  // Session 113 #4 — daily portfolio value notification.
  // Body prioritizes the live portfolio value so the user gets a real
  // "here's what your portfolio is worth this morning" summary on their
  // lock screen without opening the app. Falls back to a stock-count
  // message if no portfolio, and to a generic tap prompt if neither.
  const body = hasValue
    ? `Your portfolio is worth $${portfolioValue!.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Tap for today's summary.`
    : hasStocks
      ? `Markets are opening soon. You have ${watchlistTickers!.length} stocks to monitor. Tap for your daily summary.`
      : 'Markets are opening soon. Tap for your daily market summary.';

  // Session 113 #4 — use DAILY trigger so the notification RE-FIRES every
  // morning at 8:30 AM device local time without needing the app to be
  // opened. Previously we used TIME_INTERVAL with repeats:false which
  // fired once and never again — that's why users only saw the
  // notification once and then it silently stopped working.
  //
  // DAILY trigger is natively supported by expo-notifications and works
  // reliably on both iOS (UNCalendarNotificationTrigger) and Android
  // (AlarmManager). It fires at LOCAL device time — which is actually
  // preferable for a portfolio summary (each user gets it during their
  // own morning, not everyone at 8:30 AM ET).
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '\uD83D\uDCCA Daily Market Summary',
        body,
        data: { type: 'daily_summary', tickers: hasStocks ? watchlistTickers!.join(',') : '' },
        ...(Platform.OS === 'android' ? { channelId: 'daily-summary' } : {}),
        categoryIdentifier: 'daily_summary',
        sound: 'default',
        badge: 1,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: 8,
        minute: 30,
      },
      identifier: 'daily-summary',
    });
    console.log('[NOTIF] Daily summary scheduled with DAILY trigger at 8:30 AM local. Body:', body);
  } catch (e) {
    // DAILY trigger unsupported → fall back to one-shot DATE trigger for
    // the next 8:30 AM (today or tomorrow depending on current time).
    // The app re-schedules on next launch to keep the chain going.
    console.log('[NOTIF] DAILY trigger failed, falling back to DATE trigger:', e);
    try {
      const now = new Date();
      const target = new Date();
      target.setHours(8, 30, 0, 0);
      if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
      }
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '\uD83D\uDCCA Daily Market Summary',
          body,
          data: { type: 'daily_summary', tickers: hasStocks ? watchlistTickers!.join(',') : '' },
          ...(Platform.OS === 'android' ? { channelId: 'daily-summary' } : {}),
          categoryIdentifier: 'daily_summary',
          sound: 'default',
          badge: 1,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: target,
        },
        identifier: 'daily-summary',
      });
      console.log('[NOTIF] Daily summary scheduled with DATE trigger fallback:', target.toISOString());
    } catch (e2) {
      console.log('[NOTIF] Both DAILY and DATE triggers failed:', e2);
    }
  }
}

export async function cancelDailySummary() {
  await Notifications.cancelScheduledNotificationAsync('daily-summary').catch(() => {});
}

export async function cancelAllNotifications() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function getBadgeCount(): Promise<number> {
  return await Notifications.getBadgeCountAsync();
}

export async function resetBadgeCount() {
  await Notifications.setBadgeCountAsync(0);
}

/**
 * Send an immediate test notification — useful for verifying notifications work end-to-end.
 * Returns true if the notification was scheduled successfully, false otherwise.
 */
export async function sendTestNotification(): Promise<{ success: boolean; error?: string }> {
  if (Platform.OS === 'web') {
    return { success: false, error: 'Notifications are not supported on web' };
  }
  try {
    const granted = await isDevicePermissionGranted();
    if (!granted) {
      const requested = await requestNotificationPermissions();
      if (!requested) {
        return { success: false, error: 'Notification permission denied. Please enable in device Settings.' };
      }
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '\uD83D\uDD14 Sight Test Notification',
        body: 'Notifications are working correctly. You will receive AI signals and price alerts during market hours.',
        data: { type: 'test' },
        sound: 'default',
        badge: 1,
        ...(Platform.OS === 'android' ? { channelId: 'price-alerts' } : {}),
      },
      trigger: null,
    });
    console.log('[NOTIF] Test notification SENT');
    return { success: true };
  } catch (e: any) {
    console.log('[NOTIF] Test notification FAILED:', e);
    return { success: false, error: e?.message ?? 'Failed to send test notification' };
  }
}

// =============================================================================
// BACKEND PUSH NOTIFICATION SUPPORT
// =============================================================================
// The functions below work together with the `user_push_tokens` table + the
// `send-push-notification` edge function to deliver push notifications via
// Expo Push Service. Unlike local notifications (which only fire while the
// app is running), these push notifications reach the device even when the
// app is completely closed — delivered by APNs (iOS) / FCM (Android) via
// Expo's infrastructure.
// =============================================================================

/**
 * Upserts this device's Expo push token into the backend so the server can
 * deliver push notifications to it. Idempotent — safe to call on every login
 * and on every permission grant.
 *
 * Returns `false` (and logs) if there's no valid stored token, the platform
 * is web, or the DB write fails. Callers can safely fire-and-forget.
 */
export async function registerPushTokenToBackend(
  userId: string,
  options?: { token?: string; deviceId?: string },
): Promise<boolean> {
  if (Platform.OS === 'web' || !userId) return false;
  try {
    let token = options?.token;
    if (!token) {
      const stored = await AsyncStorage.getItem('ts_push_token');
      if (stored) token = stored;
    }
    if (!token || !token.startsWith('ExponentPushToken')) {
      console.log('[NOTIF] Skipping backend registration: no valid push token yet');
      return false;
    }
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('user_push_tokens').upsert(
      {
        user_id: userId,
        expo_push_token: token,
        device_id: options?.deviceId ?? null,
        platform: Platform.OS,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,expo_push_token' },
    );
    if (error) {
      console.log('[NOTIF] Backend push token registration error:', error.message);
      return false;
    }
    console.log('[NOTIF] Push token registered to backend for user', userId);
    return true;
  } catch (e) {
    console.log('[NOTIF] Backend push token registration exception:', e);
    return false;
  }
}

/**
 * Sends a push notification via the backend edge function. For user-scoped
 * calls (any client-side call), the caller can only send to their own devices
 * — the edge function enforces this server-side by matching the userId in
 * the body against the JWT.
 */
export async function sendPushNotificationViaBackend(params: {
  userId?: string;
  tokens?: string[];
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: string;
  badge?: number;
}): Promise<{ success: boolean; sent?: number; error?: string }> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('send-push-notification', {
      body: params,
    });
    if (error) {
      let msg = error.message;
      try {
        const anyErr = error as any;
        if (anyErr.context?.text) {
          const detail = await anyErr.context.text();
          if (detail) msg = detail;
        }
      } catch {}
      return { success: false, error: msg };
    }
    if (data?.error) {
      return { success: false, error: data.error };
    }
    return { success: true, sent: data?.sent ?? 0 };
  } catch (e: any) {
    return { success: false, error: e?.message ?? 'Push send failed' };
  }
}

/**
 * End-to-end push delivery test:
 *   1. Ensures OS-level notification permission is granted (prompts if not).
 *   2. Registers the current Expo push token to the backend.
 *   3. Calls the send-push-notification edge function to deliver a real push
 *      through Expo Push Service (APNs on iOS / FCM on Android).
 *
 * Use this in the Settings / Notifications screen to verify the push pipeline
 * works end-to-end on a real device.
 */
export async function sendTestPushNotification(userId: string): Promise<{ success: boolean; error?: string }> {
  if (Platform.OS === 'web') {
    return { success: false, error: 'Push notifications are not supported on web' };
  }
  if (!userId) {
    return { success: false, error: 'You must be signed in to test push notifications' };
  }
  const granted = await isDevicePermissionGranted();
  if (!granted) {
    const requested = await requestNotificationPermissions();
    if (!requested) {
      return { success: false, error: 'Notification permission denied. Enable in device Settings.' };
    }
  }
  const registered = await registerPushTokenToBackend(userId);
  if (!registered) {
    return { success: false, error: 'Could not register push token. Check your network connection and try again.' };
  }
  const res = await sendPushNotificationViaBackend({
    userId,
    title: 'Sight Push Test',
    body: 'Push notifications are working. You will now receive alerts even when the app is closed.',
    data: { type: 'test_push' },
    sound: 'default',
    badge: 1,
  });
  if (!res.success) return { success: false, error: res.error };
  if ((res.sent ?? 0) === 0) {
    return { success: false, error: 'No devices registered yet. Please try again in a moment.' };
  }
  return { success: true };
}
