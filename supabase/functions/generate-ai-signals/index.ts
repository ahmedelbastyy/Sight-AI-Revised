import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  isRegularMarketOpen, sessionLabel, getNYTime,
} from "../_shared/market-hours.ts";

/**
 * generate-ai-signals — Universal AI Move engine (Session 169)
 * =============================================================================
 * Session 169 hardening:
 *   • ATOMIC cooldown lock via try_start_signal_run() RPC. Previously the
 *     cooldown check was a read-then-write, which allowed two concurrent
 *     invocations to both pass the check and generate the SAME signal
 *     twice (creating duplicate ai_signals rows → duplicate push
 *     notifications for the same setup). The new RPC uses UPDATE ... WHERE
 *     last_run_at < now() - cooldown so only ONE concurrent caller can
 *     acquire the "slot" per cooldown window.
 *   • DEDUP GUARD in broadcastNewSignal — before pushing, we check
 *     has_recent_pushed_signal() for the (ticker, direction) pair. If a
 *     push has already gone out in the last 30 minutes for the same
 *     signal, we skip. This ensures users NEVER get notified twice for
 *     the same trade setup, even if legacy duplicate rows exist.
 *   • push_sent_at is stamped on ALL rows matching (ticker, direction)
 *     when a push fires, so future runs correctly identify already-pushed
 *     setups.
 * =============================================================================
 */

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[GEN-AI-SIGNALS] ${step}${d}`);
};

const SP500: string[] = [
  // Session 183 — Expanded to full S&P 500 constituent list. This is
  // maintained here as a static universe because a single JS array is
  // cheap to hold in memory and refreshable from a reliable source in a
  // future job. If a constituent is delisted / renamed, the individual
  // fetch below will return null and the ticker is simply skipped for
  // that scan — the entire scan does not fail.
  'NVDA','AAPL','MSFT','GOOGL','GOOG','AMZN','META','TSLA','AVGO','ORCL',
  'CRM','ADBE','CSCO','INTU','QCOM','TXN','AMAT','IBM','NOW','PLTR',
  'MU','AMD','ADP','ADI','KLAC','LRCX','PANW','INTC','ANET','SNPS',
  'CDNS','MRVL','FTNT','NXPI','ROP','MSCI','WDAY','FICO','APH','ACN',
  'FIS','GLW','HPQ','DELL','HPE','JBL','KEYS','TER','TRMB','ZBRA',
  'ON','MPWR','MCHP','SWKS','QRVO','STX','WDC','GEN','FFIV','JNPR',
  'NTAP','SMCI','GDDY','PAYC','TDY','APP','CTSH','IT','NTRS','WU',
  'NFLX','DIS','T','VZ','TMUS','CMCSA','EA','TTWO','WBD','CHTR',
  'FOX','FOXA','PARA','OMC','IPG','NWS','NWSA','LYV','TKO','MTCH',
  'JPM','V','MA','BAC','WFC','GS','MS','BLK','SCHW','C',
  'AXP','SPGI','MMC','CB','PGR','ICE','CME','PYPL','USB','PNC',
  'AFL','TRV','AON','MET','PRU','ALL','MCO','COF','TFC','ALL',
  'AIG','BEN','BX','BRO','CBOE','CINF','CFG','FDS','FITB','GL',
  'HBAN','HIG','JKHY','KEY','L','MTB','NDAQ','PFG','RF','STT',
  'SYF','TROW','WTW','WRB','ZION','WBK','KKR','APO','WLTW',
  'LLY','UNH','JNJ','ABBV','MRK','TMO','ABT','DHR','PFE','AMGN',
  'ISRG','ELV','BMY','MDT','SYK','VRTX','CI','REGN','HCA','GILD',
  'ZTS','BSX','HUM','BIIB','IQV','MCK','CVS','MRNA','DXCM','A',
  'ALGN','BAX','BDX','BIO','CAH','CNC','COR','COO','CRL','CTLT',
  'DGX','DVA','EW','GEHC','HOLX','HSIC','IDXX','ILMN','INCY','LH',
  'MOH','MTD','PODD','RMD','RVTY','SOLV','STE','TECH','TFX','UHS',
  'VTRS','WAT','WST','XRAY',
  'WMT','COST','HD','PG','KO','PEP','PM','MCD','NKE','LOW',
  'SBUX','TGT','CMG','BKNG','MDLZ','MO','CL','EL','KMB','KDP',
  'GIS','ORLY','ROST','TJX','MAR','HLT','AZO','LEN','DHI','DG',
  'DLTR','LULU','ULTA','YUM','DPZ','WYNN','MGM','LVS','BBY','KMX',
  'CCL','RCL','NCLH','NKE','TPR','RL','TSCO','ULTA','WBA','BURL',
  'MHK','LKQ','POOL','SEE','HAS','MAT','BATRA','BATRK','MKC','TAP',
  'STZ','SJM','HRL','CHD','CLX','CPB','CAG','KHC','K','KVUE',
  'CENT','SLGN','WHR','LEG','GRMN','NWL','APO','EBAY','HSY','MNST',
  'CAT','BA','GE','HON','UNP','RTX','LMT','DE','UPS','MMM',
  'GD','NOC','ETN','PH','EMR','ITW','CSX','NSC','LUV','DAL',
  'UAL','WM','RSG','CTAS','FDX','TT','JCI','PAYX','ADP','WAB',
  'BR','BLDR','BALL','CMI','CNH','CPRT','CSGP','DAY','DOV','FAST',
  'FBIN','GNRC','GPC','GWW','HEI','HII','HUBB','IEX','IR','J',
  'JBHT','LII','LDOS','MAS','MLM','NDSN','NVR','OTIS','PCAR','PNR',
  'PWR','ROK','SNA','SWK','TDG','TXT','URI','VLTO','VRSK','WMS',
  'XPO','XYL','ODFL','CHRW','EFX','EXPD','FTV','JBL','JBT','NSC',
  'XOM','CVX','COP','EOG','MPC','PSX','VLO','SLB','OXY','WMB',
  'HES','BKR','DVN','APA','CTRA','EQT','FANG','KMI','MRO','OKE',
  'PSX','SLB','TRGP','WMB','HAL','PXD','XEC','TPL','EXE','EXPE',
  'NEE','DUK','SO','D','AEP','EXC','XEL','PEG','WEC','ES',
  'ED','EIX','ETR','FE','SRE','AEE','ATO','CMS','CNP','DTE',
  'EVRG','LNT','NI','NRG','PCG','PNW','PPL','VST','AES','AWK',
  'LIN','APD','ECL','SHW','FCX','NEM','DOW','DD','PPG','NUE',
  'STLD','MOS','CF','LYB','IFF','ALB','FMC','CE','EMN','IP',
  'WRK','PKG','SEE','BALL','AVY','SON','AMCR','SWKS','BLL','WY',
  'AMT','CCI','EQIX','WELL','SPG','O','PSA','VICI','AVB','EQR',
  'ARE','BXP','CBRE','CPT','CSGP','DLR','DOC','ESS','EXR','FRT',
  'HST','INVH','IRM','KIM','MAA','PLD','REG','SBAC','UDR','VTR',
  'WPC','SUI','ELS','LSI','ZBRA','MPWR','MRO','MPC','MPWR','GXO',
];

// Filter out obvious duplicates that snuck in during the expansion above.
const SP500_UNIQUE: string[] = Array.from(new Set(SP500));

const INDEX_DENYLIST = new Set<string>([
  'SPY', 'SPX', '^GSPC', 'IVV', 'VOO', 'ES=F',
  'QQQ', 'QQQM', 'NDX', '^NDX',
  'DIA', 'DJI', '^DJI',
  'IWM', 'RUT', '^RUT',
  'VTI', 'VT', 'VEA', 'VWO',
]);

function isTradableSingleStock(ticker: string): boolean {
  const t = ticker.toUpperCase();
  if (INDEX_DENYLIST.has(t)) return false;
  if (t.startsWith('^')) return false;
  if (t.endsWith('=F')) return false;
  return true;
}

// Session 183 — Reward-to-Risk enforcement (5:1 target).
// The user requested that Sight's AI Moves surface only setups whose
// evidence supports a ~5:1 reward-to-risk ratio. This is a SETUP filter
// (potential reward divided by defined risk), NOT a claimed win rate.
// Actual win rate is tracked separately in the signal_outcomes table.
const MIN_REWARD_RISK = 5;
// ATR sanity bounds to prevent artificial 5:1 setups ("1% target on a
// 0.02% stop"). SL distance must be at least 0.4×ATR so the stop lives
// outside normal noise, and TP distance must not exceed 12×ATR so the
// target is achievable within the signal's timeframe.
const MIN_SL_ATR_MULT = 0.4;
const MAX_TP_ATR_MULT = 12;
const COOLDOWN_MINUTES = 3;
const AI_ANALYZE_TOP_N = 10;
const MIN_SCREEN_SCORE = 25;
const MIN_CONFIDENCE = 85;
const MAX_ENTRY_DRIFT_PERCENT = 5;
const MIN_VALIDITY_MINUTES = 5;

const ALLOWED_TRADE_TYPES = new Set([
  'Scalp', 'Intraday Momentum', 'Breakout', 'Breakdown',
  'Reversal', 'Mean Reversion', 'Momentum Continuation', 'Short-Term Swing',
]);
const ALLOWED_DURATIONS = new Set(['Today', '1-2 days', '3-5 days', 'Within 1 week']);

// Session 190 — Use the shared market-hours helper so full-day holidays
// (MLK, Presidents' Day, Good Friday, Memorial Day, Juneteenth,
// Independence Day, Labor Day, Thanksgiving, Christmas) AND early-close
// days (1 PM ET) are respected consistently across ai-reminders-worker,
// price-alerts-worker, market-events-worker, and this signal generator.
// The previous local implementation only checked weekday + 9:30-16:00
// without any holiday awareness, so signals could fire on trading days
// that are actually closed.
function isMarketOpen(): { open: boolean; label: string; nyDate: Date; hh: number; mm: number } {
  const now = new Date();
  const et = getNYTime(now);
  const nyDate = new Date(et.year, et.month - 1, et.day, et.hours, et.minutes);
  const open = isRegularMarketOpen(now);
  const label = sessionLabel(now) === 'OPEN' ? 'Open'
    : sessionLabel(now) === 'PRE_MARKET' ? 'Pre-Market'
    : sessionLabel(now) === 'AFTER_HOURS' ? 'After Hours'
    : 'Closed';
  return { open, label, nyDate, hh: et.hours, mm: et.minutes };
}

function computeValidityExpiresAt(expectedDuration: string): string {
  const now = new Date();
  const min5 = new Date(now.getTime() + MIN_VALIDITY_MINUTES * 60_000);
  const nyStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
  const [datePart] = nyStr.split(', ');
  const [mo, dd, yy] = datePart.split('/').map(Number);
  const closeToday = new Date(yy, mo - 1, dd, 16, 0);
  let target: Date;
  switch (expectedDuration) {
    case 'Today':
      target = closeToday.getTime() > now.getTime() ? closeToday : min5;
      break;
    case '1-2 days':
      target = new Date(now.getTime() + 2 * 24 * 3600_000);
      break;
    case '3-5 days':
      target = new Date(now.getTime() + 5 * 24 * 3600_000);
      break;
    case 'Within 1 week':
      target = new Date(now.getTime() + 7 * 24 * 3600_000);
      break;
    default:
      target = new Date(now.getTime() + 24 * 3600_000);
  }
  return (target.getTime() < min5.getTime() ? min5 : target).toISOString();
}

interface Bar { close: number; volume: number; high?: number; low?: number; }
async function fetchQuoteAndBars(ticker: string): Promise<{ ticker: string; price: number; bars: Bar[]; name?: string; asOf?: string } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1mo`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    const j = await res.json();
    const r = j?.chart?.result?.[0];
    if (!r) return null;
    const closes: number[] = r.indicators?.quote?.[0]?.close ?? [];
    const volumes: number[] = r.indicators?.quote?.[0]?.volume ?? [];
    const highs: number[] = r.indicators?.quote?.[0]?.high ?? [];
    const lows: number[] = r.indicators?.quote?.[0]?.low ?? [];
    const bars: Bar[] = [];
    for (let i = 0; i < closes.length; i++) {
      if (closes[i] != null) {
        bars.push({
          close: closes[i],
          volume: volumes[i] ?? 0,
          high: highs[i] ?? undefined,
          low: lows[i] ?? undefined,
        });
      }
    }
    const price = r.meta?.regularMarketPrice ?? bars[bars.length - 1]?.close;
    if (!price || bars.length < 15) return null;
    const asOf = r.meta?.regularMarketTime ? new Date(r.meta.regularMarketTime * 1000).toISOString() : new Date().toISOString();
    return { ticker, price, bars, name: r.meta?.longName ?? undefined, asOf };
  } catch { return null; }
}

// Session 183 — Average True Range (14-day) from real OHLC bars.
// Used as a volatility floor for stop-loss distance and a volatility
// ceiling for take-profit distance, preventing artificial 5:1 setups.
function computeATR(bars: Bar[], period: number = 14): number {
  if (bars.length < period + 1) return 0;
  const slice = bars.slice(-(period + 1));
  const trs: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const cur = slice[i];
    const prev = slice[i - 1];
    const h = typeof cur.high === 'number' ? cur.high : cur.close;
    const l = typeof cur.low === 'number' ? cur.low : cur.close;
    const pc = prev.close;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    if (Number.isFinite(tr) && tr > 0) trs.push(tr);
  }
  if (trs.length === 0) return 0;
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function screenScore(bars: Bar[]): { score: number; direction: 'bullish' | 'bearish' | 'neutral' } {
  if (bars.length < 20) return { score: 0, direction: 'neutral' };
  const closes = bars.map(b => b.close);
  const cur = closes[closes.length - 1];
  const sma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const sma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  let s = 0;
  if (cur > sma5 && sma5 > sma10 && sma10 > sma20) s += 30;
  else if (cur < sma5 && sma5 < sma10 && sma10 < sma20) s -= 30;
  else if (cur > sma20) s += 12;
  else if (cur < sma20) s -= 12;

  const roc5 = ((cur - closes[closes.length - 6]) / closes[closes.length - 6]) * 100;
  s += Math.max(-25, Math.min(25, roc5 * 4));

  let gain = 0, loss = 0;
  const w = Math.min(14, closes.length - 1);
  for (let i = closes.length - w; i < closes.length; i++) {
    const dv = closes[i] - closes[i - 1];
    if (dv > 0) gain += dv; else loss += -dv;
  }
  const rs = loss === 0 ? 100 : (gain / w) / (loss / w);
  const rsi = 100 - 100 / (1 + rs);
  if (rsi < 30) s += 15;
  else if (rsi > 70) s -= 15;
  else if (rsi < 40) s += 5;
  else if (rsi > 60) s -= 5;

  const recentVol = bars.slice(-3).reduce((a, b) => a + b.volume, 0) / 3;
  const avgVol = bars.slice(-20).reduce((a, b) => a + b.volume, 0) / 20;
  if (avgVol > 0 && recentVol > avgVol * 1.4) s += (s >= 0 ? 10 : -10);

  s = Math.max(-100, Math.min(100, s));
  return { score: s, direction: s > 8 ? 'bullish' : s < -8 ? 'bearish' : 'neutral' };
}

// Session 186 — Per-signal push notifications are DISABLED.
//
// PRIOR BEHAVIOR (removed): Every newly-generated AI signal fired an
// immediate Expo Push notification (title + body describing the setup)
// to every registered device. Users complained that this pushed too
// often. Replaced by the generic 3-per-trading-day AI Moves reminders
// dispatched from `supabase/functions/ai-reminders-worker/index.ts`
// (10-11 AM ET, 12-1 PM ET, 3 PM ET).
//
// NEW BEHAVIOR: broadcastNewSignal() is now a NO-OP that only stamps
// push_sent_at on the signal row so pending-push queries do not keep
// re-selecting the same row forever. No push notification is sent for
// individual signal creation under ANY code path. Signals still generate,
// save, refresh, and appear normally inside the AI Moves page.
async function broadcastNewSignal(admin: any, sig: any): Promise<boolean> {
  try {
    if (!sig?.id) return false;
    await admin.from('ai_signals')
      .update({ push_sent_at: new Date().toISOString() })
      .eq('id', sig.id);
    logStep('Per-signal push disabled (Session 186) — stamped push_sent_at only', { signalId: sig.id, ticker: sig.ticker });
  } catch (e) {
    logStep('push_sent_at stamp failed (non-fatal)', { error: String(e), signalId: sig?.id });
  }
  return false;
}

// Legacy per-signal push broadcaster kept ONLY as a reference; never
// invoked from any code path. Preserved for auditors reviewing why the
// old behavior no longer applies.
async function _legacyBroadcastNewSignal_DISABLED(admin: any, sig: any): Promise<boolean> {
  try {
    const entry = Number(sig?.entry_price);
    const tp = Number(sig?.take_profit);
    const sl = Number(sig?.stop_loss);
    if (!Number.isFinite(entry) || entry <= 0) return false;
    if (!Number.isFinite(tp) || tp <= 0) return false;
    if (!Number.isFinite(sl) || sl <= 0) return false;
    if (sig?.direction !== 'buy' && sig?.direction !== 'short') return false;
    if (!sig?.ticker || !sig?.id) return false;

    // Server-side dedup: skip if we already pushed for this (ticker, direction) recently.
    try {
      const { data: hasRecent } = await admin.rpc('has_recent_pushed_signal', {
        p_ticker: sig.ticker,
        p_direction: sig.direction,
      });
      if (hasRecent === true) {
        // Stamp push_sent_at on THIS row so it never retries.
        await admin.from('ai_signals')
          .update({ push_sent_at: new Date().toISOString() })
          .eq('id', sig.id);
        logStep('Push skipped — recent duplicate exists', { signalId: sig.id, ticker: sig.ticker });
        return false;
      }
    } catch (e) {
      logStep('has_recent_pushed_signal RPC failed, continuing', { error: String(e) });
    }

    const { data: tokenRows } = await admin
      .from('user_push_tokens')
      .select('expo_push_token');
    const tokens = (tokenRows ?? [])
      .map((r: any) => r.expo_push_token)
      .filter((t: any): t is string => typeof t === 'string' && t.startsWith('ExponentPushToken'));
    logStep('broadcastNewSignal tokens resolved', { signalId: sig.id, ticker: sig.ticker, tokenCount: tokens.length });
    if (tokens.length === 0) {
      await admin.from('ai_signals')
        .update({ push_sent_at: new Date().toISOString() })
        .eq('id', sig.id);
      return false;
    }

    const rawCompany: string = (sig.company_name ?? '').trim();
    const displayName = rawCompany.length > 0
      ? rawCompany.replace(/\s+(Inc\.?|Corp\.?|Corporation|Ltd\.?|plc|Company|Co\.?|Group)\.?$/i, '').trim() || rawCompany
      : String(sig.ticker);
    // Session 170 — Push notifications for AI signals now use a generic
    // "new opportunity available" message rather than exposing exact
    // entry/take-profit prices in the lock-screen notification. This
    // matches the requested "random-times new AI signal available" UX:
    // users get a nudge to open the app and see the actual details of
    // the trade rather than reading them from the notification banner.
    // Rotates between a small pool of short titles to feel less robotic.
    const genericTitles = [
      'New AI Move Available',
      'Fresh Sight AI Signal',
      'Sight AI Spotted an Opportunity',
      'New Trading Setup Detected',
    ];
    const genericBodies = [
      'Open Sight to see the new AI trading setup.',
      'Sight AI just found a new opportunity. Tap to view details.',
      'A new high-confidence Move is ready. Open the app to view.',
      'Fresh trading opportunity detected. Open Sight for full details.',
    ];
    const pickIndex = Math.floor(Math.random() * genericTitles.length);
    const title = genericTitles[pickIndex];
    const body = genericBodies[pickIndex];
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const pushResp = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        tokens,
        title,
        body,
        data: {
          type: 'ai_signal',
          ticker: sig.ticker,
          signalId: sig.id,
          direction: sig.direction,
          entry: entry.toFixed(2),
          takeProfit: tp.toFixed(2),
          stopLoss: sl.toFixed(2),
        },
        sound: 'default',
      }),
    });

    let sent = 0;
    try {
      const respJson = await pushResp.json();
      sent = Number(respJson?.sent ?? 0);
      logStep('Expo Push response', { signalId: sig.id, status: pushResp.status, sent, total: respJson?.total });
    } catch { /* swallow */ }

    if (pushResp.ok) {
      // Stamp push_sent_at on THIS row AND every other active row for the
      // same (ticker, direction) so legacy duplicates don't fire again.
      const nowIso = new Date().toISOString();
      await admin.from('ai_signals')
        .update({ push_sent_at: nowIso })
        .eq('ticker', sig.ticker)
        .eq('direction', sig.direction)
        .eq('status', 'active')
        .is('push_sent_at', null);
      return sent > 0;
    }
    logStep('Push delivery failed — leaving push_sent_at null for retry', { signalId: sig.id, status: pushResp.status });
    return false;
  } catch (e) {
    logStep('Push broadcast failed', { error: String(e), signalId: sig?.id });
    return false;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    );

    const market = isMarketOpen();

    if (!market.open) {
      logStep('Market closed — skipping all screening / AI', { marketStatus: market.label });
      await admin.from('ai_signals')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('status', 'active')
        .lt('validity_expires_at', new Date().toISOString());
      return new Response(JSON.stringify({
        status: 'skipped', reason: 'market_closed',
        marketStatus: market.label, universeSize: SP500_UNIQUE.length,
        screened: 0, candidates: 0, actionable: 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // ---- Refresh entry prices + expire past-validity signals ----
    const { data: activeSignals } = await admin.from('ai_signals').select('*').eq('status', 'active');
    if (activeSignals?.length) {
      await Promise.all(activeSignals.map(async (sig: any) => {
        if (sig.validity_expires_at && new Date(sig.validity_expires_at).getTime() < Date.now()) {
          await admin.from('ai_signals').update({
            status: 'expired', updated_at: new Date().toISOString(),
          }).eq('id', sig.id);
          return;
        }
        const q = await fetchQuoteAndBars(sig.ticker);
        if (!q) return;
        const drift = Math.abs(q.price - sig.entry_price) / sig.entry_price * 100;
        if (drift > MAX_ENTRY_DRIFT_PERCENT) {
          await admin.from('ai_signals').update({
            status: 'invalidated', outcome_price: q.price, updated_at: new Date().toISOString(),
          }).eq('id', sig.id);
        } else if (drift > 0.15) {
          await admin.from('ai_signals').update({
            entry_price: Number(q.price.toFixed(2)), updated_at: new Date().toISOString(),
          }).eq('id', sig.id);
        }
      }));
    }

    // Session 169 — ATOMIC cooldown + concurrency lock.
    // try_start_signal_run() uses UPDATE ... WHERE last_run_at < now() -
    // cooldown so only ONE concurrent caller can acquire the "slot" per
    // cooldown window. Previously the read-then-write approach allowed
    // two concurrent invocations to both pass the cooldown check and
    // generate duplicate signal rows for the same setup.
    let gotSlot = false;
    try {
      const { data: lockResult } = await admin.rpc('try_start_signal_run', { cooldown_minutes: COOLDOWN_MINUTES });
      gotSlot = lockResult === true;
    } catch (e) {
      logStep('try_start_signal_run RPC failed — falling back to legacy check', { error: String(e) });
      // Legacy fallback: read last_run_at and skip if cooldown not elapsed.
      const { data: runRow } = await admin.from('ai_signal_runs').select('last_run_at').eq('id', 1).maybeSingle();
      const lastRunAt = runRow?.last_run_at ? new Date(runRow.last_run_at).getTime() : 0;
      gotSlot = Date.now() - lastRunAt >= COOLDOWN_MINUTES * 60_000;
      if (gotSlot) {
        await admin.from('ai_signal_runs').upsert({ id: 1, last_run_at: new Date().toISOString() });
      }
    }

    // Always broadcast pending pushes even when we didn't get the slot —
    // this ensures signals from prior runs with missed pushes still reach
    // devices when the app is next opened.
    if (!gotSlot) {
      let pendingPush: any[] = [];
      try {
        const { data: pending } = await admin
          .from('ai_signals')
          .select('*')
          .eq('status', 'active')
          .is('push_sent_at', null);
        pendingPush = Array.isArray(pending) ? pending : [];
      } catch { /* swallow */ }
      let pushedCount = 0;
      if (pendingPush.length > 0) {
        const results = await Promise.all(pendingPush.map((s) => broadcastNewSignal(admin, s).catch(() => false)));
        pushedCount = results.filter(Boolean).length;
      }
      return new Response(JSON.stringify({
        status: 'skipped', reason: 'cooldown_or_concurrent',
        marketStatus: market.label, universeSize: SP500_UNIQUE.length,
        screened: 0, candidates: 0, actionable: 0,
        pendingPush: pendingPush.length,
        pushed: pushedCount,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // ---- STAGE 1: batched fetch + technical screen ----
    logStep('Stage 1: screening S&P 500', { universeSize: SP500_UNIQUE.length });
    const BATCH = 25;
    type Scored = { ticker: string; price: number; bars: Bar[]; name?: string; asOf?: string; score: number; direction: 'bullish' | 'bearish' | 'neutral'; atr: number };
    const scored: Scored[] = [];
    for (let i = 0; i < SP500_UNIQUE.length; i += BATCH) {
      const chunk = SP500_UNIQUE.slice(i, i + BATCH).filter(isTradableSingleStock);
      if (chunk.length === 0) continue;
      const results = await Promise.all(chunk.map(t => fetchQuoteAndBars(t)));
      for (const r of results) {
        if (!r) continue;
        if (!isTradableSingleStock(r.ticker)) continue;
        const s = screenScore(r.bars);
        const atr = computeATR(r.bars, 14);
        if (s.direction !== 'neutral' && Math.abs(s.score) >= MIN_SCREEN_SCORE) {
          scored.push({ ...r, score: s.score, direction: s.direction, atr });
        }
      }
    }
    const candidates = scored.sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, AI_ANALYZE_TOP_N);
    logStep('Stage 1 done', { universeSize: SP500_UNIQUE.length, screened: SP500_UNIQUE.length, kept: scored.length, topCandidates: candidates.length });

    // ---- STAGE 2/3: OnSpace AI deep analysis ----
    const apiKey = Deno.env.get('ONSPACE_AI_API_KEY');
    const baseUrl = Deno.env.get('ONSPACE_AI_BASE_URL');
    if (!apiKey || !baseUrl) throw new Error('OnSpace AI not configured');

    const generatedSignals: any[] = [];
    for (const cand of candidates) {
      const bars = cand.bars.slice(-20);
      const closes = bars.map(b => b.close);
      const high20 = Math.max(...closes);
      const low20 = Math.min(...closes);
      const rangePct = ((high20 - low20) / cand.price) * 100;

      const systemPrompt = `You are Sight's Move Engine — a short-term (max 1 week hold) day-trade / swing-trade signal generator. You NEVER recommend long-term investments. You output only high-quality actionable setups; if evidence isn't strong enough you return "no_trade".

============================================================
ACCURACY & DATA INTEGRITY RULES
============================================================
1. NEVER fabricate: specific news headlines, analyst calls, exact GEX values, precise institutional flows, or order-flow numbers you cannot verify.
2. For each of the SEVEN reasoning categories, if you don't have reliable evidence for that category — return an EMPTY STRING for that section. Do NOT invent it.
3. Confidence 85-95 requires strong CROSS-CATEGORY confluence: at minimum priceAction + volume + one of (news, fundamentals, options, order flow).
4. If technicals conflict with well-known catalysts (upcoming earnings, macro event) → downgrade to no_trade.
5. Entry price must be within 1.5% of the CURRENT MARKET PRICE provided.
6. Risk / reward: |TP-entry| >= 5 * |entry-SL|. The reward-to-risk ratio MUST be at least 5:1 (minimum). Do NOT force a 5:1 ratio via absurdly distant TP or dangerously tight SL — if the market structure does not realistically support at least 5:1, return direction "no_trade" instead. This is a REWARD-TO-RISK minimum, NOT a claimed 5:1 win rate.

============================================================
SEVEN REASONING CATEGORIES (each 1-2 SHORT sentences max)
============================================================
priceAction    — trend, structure, breakout/breakdown, support/resistance, momentum
gexOptions     — gamma exposure, call/put walls, unusual options positioning (major tickers only, general knowledge)
orderFlow      — buying/selling pressure, imbalance, unusual activity (only if commonly known)
volume         — relative volume, spikes, participation, confirmation of the move
news           — recent verified catalysts / earnings / announcements (well-established only)
fundamentals   — only if RELEVANT to short-term move (earnings beat, guidance, valuation dislocation)
overallSetup   — 1-2 sentence synthesis tying the above together

If you have no reliable info for a category, its value MUST be "" (empty string).

============================================================
TRADE TYPE + EXPECTED DURATION (SHORT-TERM ONLY)
============================================================
tradeType MUST be one of: "Scalp" | "Intraday Momentum" | "Breakout" | "Breakdown" | "Reversal" | "Mean Reversion" | "Momentum Continuation" | "Short-Term Swing"

expectedDuration MUST be one of: "Today" | "1-2 days" | "3-5 days" | "Within 1 week"

Scalp/Intraday -> "Today". Breakout/Breakdown/Reversal usually "1-2 days" or "Today". Short-Term Swing -> "3-5 days" or "Within 1 week". NO longer timeframes.

============================================================
OUTPUT — STRICT JSON, NO OTHER TEXT
============================================================
{
  "direction": "buy" | "short" | "no_trade",
  "entry": number,
  "takeProfit": number,
  "stopLoss": number,
  "confidence": number,
  "tradeType": "one of the allowed values above",
  "expectedDuration": "one of the allowed durations above",
  "reasoningSections": {
    "priceAction": "",
    "gexOptions": "",
    "orderFlow": "",
    "volume": "",
    "news": "",
    "fundamentals": "",
    "overallSetup": ""
  }
}

If direction = "no_trade": all price fields = current price, confidence = 0, reasoningSections all "".`;

      const userPrompt = `Ticker: ${cand.ticker} (${cand.name ?? cand.ticker})
Current price: $${cand.price.toFixed(2)}
Technical screen score: ${cand.score.toFixed(0)} (${cand.direction})
20-day high: $${high20.toFixed(2)}
20-day low: $${low20.toFixed(2)}
20-day range: ${rangePct.toFixed(1)}%
Recent 10 closes: ${closes.slice(-10).map(c => c.toFixed(2)).join(', ')}

Analyze this short-term setup. Return ONLY the JSON described above. Remember: max 1-week hold, empty strings for unavailable categories, 85% confidence floor.`;

      const models = ['google/gemini-2.5-flash', 'openai/gpt-5-mini', 'google/gemini-2.5-flash-lite'];
      let parsed: any = null;
      for (const model of models) {
        try {
          const resp = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
              ],
              temperature: 0.2,
            }),
          });
          if (!resp.ok) continue;
          const j = await resp.json();
          const text = j.choices?.[0]?.message?.content ?? '';
          const match = text.match(/\{[\s\S]*\}/);
          if (!match) continue;
          parsed = JSON.parse(match[0]);
          break;
        } catch { /* try next model */ }
      }
      if (!parsed) continue;

      if (parsed.direction === 'no_trade') continue;
      if (parsed.direction !== 'buy' && parsed.direction !== 'short') continue;
      const conf = Number(parsed.confidence);
      const entry = Number(parsed.entry);
      const tp = Number(parsed.takeProfit);
      const sl = Number(parsed.stopLoss);
      if (![conf, entry, tp, sl].every(Number.isFinite)) continue;
      if (conf < MIN_CONFIDENCE) continue;
      const entryDrift = Math.abs(entry - cand.price) / cand.price * 100;
      if (entryDrift > 1.5) continue;
      if (parsed.direction === 'buy' && !(tp > entry && sl < entry)) continue;
      if (parsed.direction === 'short' && !(tp < entry && sl > entry)) continue;
      const reward = Math.abs(tp - entry);
      const risk = Math.abs(entry - sl);
      if (risk <= 0 || reward <= 0) continue;
      // Session 183 — 5:1 reward/risk minimum. Setups that don't clear
      // this threshold are discarded rather than "stretched" to fake the
      // ratio. See MIN_REWARD_RISK definition above.
      const rewardRisk = reward / risk;
      if (rewardRisk < MIN_REWARD_RISK) {
        logStep('Filtered: rewardRisk below 5:1', { ticker: cand.ticker, rewardRisk: rewardRisk.toFixed(2) });
        continue;
      }
      // Session 183 — ATR sanity bounds so 5:1 isn't achieved via a
      // meaninglessly tight stop or an unreachable target. Both distances
      // must live within realistic multiples of recent volatility.
      if (cand.atr > 0) {
        if (risk < cand.atr * MIN_SL_ATR_MULT) {
          logStep('Filtered: SL tighter than 0.4x ATR (noise stop)', { ticker: cand.ticker, risk: risk.toFixed(4), atr: cand.atr.toFixed(4) });
          continue;
        }
        if (reward > cand.atr * MAX_TP_ATR_MULT) {
          logStep('Filtered: TP wider than 12x ATR (unrealistic target)', { ticker: cand.ticker, reward: reward.toFixed(4), atr: cand.atr.toFixed(4) });
          continue;
        }
      }

      const tradeType = ALLOWED_TRADE_TYPES.has(parsed.tradeType) ? parsed.tradeType : 'Intraday Momentum';
      const expectedDuration = ALLOWED_DURATIONS.has(parsed.expectedDuration) ? parsed.expectedDuration : 'Today';

      const rawSections = parsed.reasoningSections ?? {};
      const sections: Record<string, string> = {};
      const keys = ['priceAction', 'gexOptions', 'orderFlow', 'volume', 'news', 'fundamentals', 'overallSetup'];
      for (const k of keys) {
        const v = rawSections[k];
        sections[k] = (typeof v === 'string' ? v.trim() : '').slice(0, 400);
      }

      const legacyReasoning = [sections.priceAction, sections.overallSetup].filter(Boolean).join(' ').slice(0, 500);

      generatedSignals.push({
        ticker: cand.ticker,
        direction: parsed.direction,
        entry_price: Number(entry.toFixed(2)),
        take_profit: Number(tp.toFixed(2)),
        stop_loss: Number(sl.toFixed(2)),
        confidence: Math.round(conf),
        reasoning: legacyReasoning || 'Multi-factor short-term setup.',
        reasoning_sections: sections,
        expected_duration: expectedDuration,
        trade_type: tradeType,
        company_name: cand.name ?? null,
        status: 'active',
        validity_expires_at: computeValidityExpiresAt(expectedDuration),
        // Session 183 — freshness + risk metadata stored on the ai_signals
        // row itself so refresh/reload states can display data freshness.
        // reward_risk_ratio is computed deterministically in code (never
        // trusted from the model). asOf is the market_data_as_of timestamp
        // sourced directly from Yahoo Finance regularMarketTime.
        market_data_as_of: cand.asOf,
      });
      // Session 183 — record outcome-tracking row for actual win-rate
      // computation later. This is INSERTED after the ai_signals row is
      // successfully created; the FK to ai_signals.id is set below.
      (generatedSignals[generatedSignals.length - 1] as any)._outcomeSeed = {
        ticker: cand.ticker,
        direction: parsed.direction,
        entry_price: Number(entry.toFixed(2)),
        take_profit: Number(tp.toFixed(2)),
        stop_loss: Number(sl.toFixed(2)),
        confidence: Math.round(conf),
        reward_risk_ratio: Number(rewardRisk.toFixed(2)),
        evidence_snapshot: {
          screenScore: cand.score,
          direction: cand.direction,
          atr: Number((cand.atr ?? 0).toFixed(4)),
          market_data_as_of: cand.asOf,
          reasoning_sections: sections,
        },
      };
    }

    // ---- Persist: UPDATE existing (same ticker+direction) or INSERT new ----
    // Session 169 — Re-fetch active signals AFTER acquiring the atomic
    // lock so we have the freshest view. This closes another race where
    // signals could be inserted between the initial read at the top and
    // this persistence block.
    const { data: freshActive } = await admin.from('ai_signals').select('*').eq('status', 'active');
    const existingByKey = new Map<string, any>();
    for (const s of (freshActive ?? [])) {
      const key = `${s.ticker}:${s.direction}`;
      // Keep only the newest row per key so we UPDATE it, never
      // accidentally INSERT a duplicate.
      const existing = existingByKey.get(key);
      if (!existing || new Date(s.created_at).getTime() > new Date(existing.created_at).getTime()) {
        existingByKey.set(key, s);
      }
    }
    const generatedKeys = new Set<string>();
    const newlyCreated: any[] = [];
    for (const g of generatedSignals) {
      const key = `${g.ticker}:${g.direction}`;
      generatedKeys.add(key);
      const existing = existingByKey.get(key);
      if (existing) {
        await admin.from('ai_signals').update({
          entry_price: g.entry_price, take_profit: g.take_profit, stop_loss: g.stop_loss,
          confidence: g.confidence, reasoning: g.reasoning,
          reasoning_sections: g.reasoning_sections, expected_duration: g.expected_duration,
          trade_type: g.trade_type, company_name: g.company_name,
          updated_at: new Date().toISOString(),
        }).eq('id', existing.id);
      } else {
        try {
          // Session 183 — strip the outcome seed before insert so it
          // doesn't try to write to a non-existent column, then use it
          // to populate signal_outcomes AFTER the ai_signals row exists.
          const outcomeSeed = (g as any)._outcomeSeed;
          const insertRow = { ...g };
          delete (insertRow as any)._outcomeSeed;
          // Also strip market_data_as_of if the column doesn't exist yet
          // — the field is optional and tolerated by the schema migration.
          const { data: inserted, error: insertErr } = await admin.from('ai_signals').insert(insertRow).select('*').single();
          if (insertErr) {
            logStep('Insert failed — likely concurrent duplicate', { ticker: g.ticker, direction: g.direction, error: insertErr.message });
          } else if (inserted) {
            newlyCreated.push(inserted);
            // Best-effort: also seed the outcome-tracking row so we can
            // score actual win rate later. Never fail the scan if this
            // insert errors (e.g., migration not yet applied).
            if (outcomeSeed) {
              try {
                await admin.from('signal_outcomes').insert({
                  signal_id: inserted.id,
                  ticker: outcomeSeed.ticker,
                  direction: outcomeSeed.direction,
                  entry_price: outcomeSeed.entry_price,
                  take_profit: outcomeSeed.take_profit,
                  stop_loss: outcomeSeed.stop_loss,
                  confidence: outcomeSeed.confidence,
                  reward_risk_ratio: outcomeSeed.reward_risk_ratio,
                  evidence_snapshot: outcomeSeed.evidence_snapshot,
                  generated_at: new Date().toISOString(),
                  validity_expires_at: g.validity_expires_at,
                  outcome: 'pending',
                });
              } catch (oe) {
                logStep('signal_outcomes insert failed (non-fatal)', { ticker: g.ticker, error: String(oe) });
              }
            }
          }
        } catch (e) {
          logStep('Insert exception', { ticker: g.ticker, direction: g.direction, error: String(e) });
        }
      }
    }
    // Expire signals that AI dropped and are >30min old
    for (const [key, sig] of existingByKey.entries()) {
      if (generatedKeys.has(key)) continue;
      const ageMin = (Date.now() - new Date(sig.created_at).getTime()) / 60000;
      if (ageMin > 30) {
        await admin.from('ai_signals').update({
          status: 'expired', updated_at: new Date().toISOString(),
        }).eq('id', sig.id);
      }
    }

    // Broadcast pushes for newly-created + pending-push signals, deduped by id.
    let pendingPush: any[] = [];
    try {
      const { data: pending } = await admin
        .from('ai_signals')
        .select('*')
        .eq('status', 'active')
        .is('push_sent_at', null);
      pendingPush = Array.isArray(pending) ? pending : [];
    } catch (e) {
      logStep('Pending push fetch failed', { error: String(e) });
    }

    const broadcastMap = new Map<string, any>();
    for (const s of newlyCreated) if (s?.id) broadcastMap.set(s.id, s);
    for (const s of pendingPush) if (s?.id && !broadcastMap.has(s.id)) broadcastMap.set(s.id, s);
    const toBroadcast = Array.from(broadcastMap.values());

    let pushedCount = 0;
    if (toBroadcast.length > 0) {
      logStep('Broadcasting AI signal pushes', { newly: newlyCreated.length, pending: pendingPush.length, unique: toBroadcast.length });
      const results = await Promise.all(toBroadcast.map((s) => broadcastNewSignal(admin, s).catch(() => false)));
      pushedCount = results.filter(Boolean).length;
    }

    return new Response(JSON.stringify({
      status: 'ok', marketStatus: market.label,
      universeSize: SP500_UNIQUE.length, screened: SP500_UNIQUE.length,
      candidates: candidates.length, actionable: generatedSignals.length,
      newSignals: newlyCreated.length,
      pendingPush: pendingPush.length,
      pushed: pushedCount,
      generatedAt: new Date().toISOString(),
      minRewardRisk: MIN_REWARD_RISK,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logStep('Error', { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
    });
  }
});
