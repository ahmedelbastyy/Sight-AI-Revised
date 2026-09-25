// price-alerts-worker
// =============================================================================
// Session 174 — Server-side per-watchlist price movement alerts.
//
// Runs every minute during the regular US market session. High level:
//
//   1. Determine session — abort immediately if the regular market is not open.
//   2. Load every user with push_enabled + priceMovements enabled and at least
//      one registered push token.
//   3. For each user pull their watchlist tickers from user_watchlists. Union
//      all watched tickers across all interested users so each ticker is
//      quoted AT MOST ONCE per cycle even if hundreds of users watch it.
//   4. Batch-fetch VERIFIED quotes for the union set (Yahoo Finance chart API
//      with a small parallelism cap; Finnhub if the Yahoo call fails).
//   5. For each (user, ticker) pair evaluate the ABSOLUTE daily % change vs
//      the user's configured priceThreshold (1/2/3/5/10 percent). If the
//      change reaches or exceeds the threshold AND we have NOT already sent
//      an alert for this (user_id, ticker, trading_date, threshold) tuple,
//      insert a dedup row and send a push. The unique constraint prevents
//      duplicate deliveries even if the worker fires many times per session.
//   6. NEVER trigger an alert from a fabricated / fallback price. If the
//      quote provider returns no verified regular-session price, we simply
//      skip that ticker this cycle.
//
// The dedup key includes `threshold` so if the user changes their threshold
// mid-day from 5% to 1%, the newly-lower threshold alerts fire independently
// of any earlier deliveries at the old threshold.
// =============================================================================

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  currentTradingDate, isRegularMarketOpen, sessionLabel,
} from '../_shared/market-hours.ts';

const log = (step: string, details?: unknown) => {
  const d = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[PRICE-ALERTS] ${step}${d}`);
};

interface Quote {
  ticker: string;
  price: number;
  previousClose: number;
  changePercent: number; // signed
}

// Cap parallelism to be nice to the quote provider — 6 in-flight requests.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchYahooQuote(ticker: string): Promise<Quote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    const j = await res.json();
    const r = j?.chart?.result?.[0];
    if (!r) return null;
    const price = Number(r.meta?.regularMarketPrice);
    const previousClose = Number(r.meta?.chartPreviousClose ?? r.meta?.previousClose);
    if (!Number.isFinite(price) || price <= 0) return null;
    if (!Number.isFinite(previousClose) || previousClose <= 0) return null;
    const changePercent = ((price - previousClose) / previousClose) * 100;
    return { ticker, price, previousClose, changePercent };
  } catch { return null; }
}

async function fetchFinnhubQuote(ticker: string, apiKey: string): Promise<Quote | null> {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = await res.json();
    const price = Number(j?.c);
    const previousClose = Number(j?.pc);
    if (!Number.isFinite(price) || price <= 0) return null;
    if (!Number.isFinite(previousClose) || previousClose <= 0) return null;
    const changePercent = ((price - previousClose) / previousClose) * 100;
    return { ticker, price, previousClose, changePercent };
  } catch { return null; }
}

async function fetchQuoteWithFallback(ticker: string, finnhubKey: string | undefined): Promise<Quote | null> {
  const yahoo = await fetchYahooQuote(ticker);
  if (yahoo) return yahoo;
  if (finnhubKey) return await fetchFinnhubQuote(ticker, finnhubKey);
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const finnhubKey = Deno.env.get('FINNHUB_API_KEY');
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const now = new Date();
  const tradingDate = currentTradingDate(now);

  if (!isRegularMarketOpen(now)) {
    log('skip — market not in regular session', { session: sessionLabel(now), tradingDate });
    return new Response(JSON.stringify({ status: 'skipped', reason: 'market_closed', tradingDate }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // --- 1. Load interested users -------------------------------------------
  const { data: profileRows, error: pErr } = await admin
    .from('user_profiles')
    .select('id, notif_prefs');
  if (pErr) {
    log('profile fetch error', { error: pErr.message });
    return new Response(JSON.stringify({ error: pErr.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  type Interested = { userId: string; threshold: number };
  const interested: Interested[] = [];
  for (const row of profileRows ?? []) {
    const p = (row as any).notif_prefs ?? null;
    if (!p) continue; // opt-in requires having interacted with prefs at least once? No — default is enabled.
    const enabled = p.enabled !== false;
    const priceOn = p.priceMovements !== false;
    const threshold = Number(p.priceThreshold ?? 3);
    if (!enabled || !priceOn) continue;
    if (!Number.isFinite(threshold) || threshold <= 0) continue;
    interested.push({ userId: (row as any).id, threshold });
  }
  // Users without notif_prefs are treated as "on with default threshold=3" —
  // matches client DEFAULT_PREFS behavior.
  const explicitlyOptedOut = new Set(
    (profileRows ?? [])
      .filter((row: any) => {
        const p = row.notif_prefs;
        if (!p) return false;
        return p.enabled === false || p.priceMovements === false;
      })
      .map((row: any) => row.id),
  );
  for (const row of profileRows ?? []) {
    if ((row as any).notif_prefs) continue;
    if (explicitlyOptedOut.has((row as any).id)) continue;
    interested.push({ userId: (row as any).id, threshold: 3 });
  }
  log('interested users', { count: interested.length });
  if (interested.length === 0) {
    return new Response(JSON.stringify({ status: 'ok', tradingDate, delivered: 0 }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // --- 2. Load each user's watchlist --------------------------------------
  const userIds = interested.map((i) => i.userId);
  const { data: wlRows, error: wlErr } = await admin
    .from('user_watchlists')
    .select('user_id, watchlist')
    .in('user_id', userIds);
  if (wlErr) {
    log('watchlist fetch error', { error: wlErr.message });
    return new Response(JSON.stringify({ error: wlErr.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const userToWatchlist = new Map<string, string[]>();
  for (const row of wlRows ?? []) {
    const list = Array.isArray((row as any).watchlist) ? (row as any).watchlist : [];
    const clean = list
      .map((t: any) => (typeof t === 'string' ? t.toUpperCase().trim() : ''))
      .filter((t: string) => t.length > 0 && t.length <= 10);
    if (clean.length > 0) userToWatchlist.set((row as any).user_id, clean);
  }

  const tickerUnion = new Set<string>();
  for (const list of userToWatchlist.values()) list.forEach((t) => tickerUnion.add(t));
  const tickerList = Array.from(tickerUnion);
  log('ticker union', { count: tickerList.length });
  if (tickerList.length === 0) {
    return new Response(JSON.stringify({ status: 'ok', tradingDate, delivered: 0, reason: 'empty_union' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // --- 3. Batch-fetch verified quotes -------------------------------------
  const quoteArr = await mapWithConcurrency(tickerList, 6, (t) => fetchQuoteWithFallback(t, finnhubKey));
  const quotes = new Map<string, Quote>();
  for (const q of quoteArr) {
    if (q) quotes.set(q.ticker, q);
  }
  log('quotes fetched', { requested: tickerList.length, resolved: quotes.size });

  // --- 4. Evaluate thresholds + fan out pushes ----------------------------
  let delivered = 0;
  let dedupedSkips = 0;
  let belowThreshold = 0;
  let missingQuote = 0;

  // Pre-load already-delivered rows for today so we don't perform a per-user
  // insert-and-check when we know they'd conflict. Cheap: one small query.
  const { data: existingDeliveries } = await admin
    .from('price_alert_deliveries')
    .select('user_id, ticker, threshold_percent')
    .eq('trading_date', tradingDate)
    .in('user_id', userIds);
  const seen = new Set<string>();
  for (const row of existingDeliveries ?? []) {
    seen.add(`${(row as any).user_id}|${(row as any).ticker}|${Number((row as any).threshold_percent)}`);
  }

  for (const { userId, threshold } of interested) {
    const wl = userToWatchlist.get(userId);
    if (!wl || wl.length === 0) continue;

    // Fetch this user's push tokens once per user to avoid re-querying inside
    // the ticker loop.
    const { data: tokenRows } = await admin
      .from('user_push_tokens')
      .select('expo_push_token')
      .eq('user_id', userId);
    const tokens = (tokenRows ?? [])
      .map((r: any) => r.expo_push_token)
      .filter((t: any): t is string => typeof t === 'string' && t.startsWith('ExponentPushToken'));
    if (tokens.length === 0) continue;

    for (const ticker of wl) {
      const q = quotes.get(ticker);
      if (!q) { missingQuote++; continue; }
      if (Math.abs(q.changePercent) < threshold) { belowThreshold++; continue; }
      const key = `${userId}|${ticker}|${threshold}`;
      if (seen.has(key)) { dedupedSkips++; continue; }

      // Insert dedup row FIRST — the unique constraint guarantees only one
      // caller can win if two workers race. If the insert conflicts (23505)
      // we skip. Only after a successful insert do we send the push.
      const { error: dedupErr } = await admin
        .from('price_alert_deliveries')
        .insert({
          user_id: userId,
          ticker,
          trading_date: tradingDate,
          threshold_percent: threshold,
          change_percent: q.changePercent,
          price: q.price,
        });
      if (dedupErr) {
        if ((dedupErr as any).code !== '23505') {
          log('dedup insert error', { userId, ticker, code: (dedupErr as any).code, msg: dedupErr.message });
        }
        dedupedSkips++;
        continue;
      }
      seen.add(key);

      const direction = q.changePercent >= 0 ? 'up' : 'down';
      const sign = q.changePercent > 0 ? '+' : '';
      const title = `${ticker} moved ${direction} ${sign}${q.changePercent.toFixed(2)}%`;
      const body = `${ticker} is trading at $${q.price.toFixed(2)}, a ${sign}${q.changePercent.toFixed(2)}% move today. This crosses your ${threshold}% alert.`;
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            userId,
            tokens,
            title,
            body,
            data: { type: 'price_alert', ticker, threshold, changePercent: q.changePercent, tradingDate },
            sound: 'default',
          }),
        });
        const j = await res.json().catch(() => ({}));
        if (res.ok && Number(j?.sent ?? 0) > 0) {
          delivered++;
        } else {
          log('push not delivered', { userId, ticker, sent: j?.sent, blocked: j?.blocked });
        }
      } catch (e) {
        log('push exception', { userId, ticker, error: String(e) });
      }
    }
  }

  log('cycle complete', { delivered, dedupedSkips, belowThreshold, missingQuote, tradingDate });
  return new Response(
    JSON.stringify({ status: 'ok', tradingDate, delivered, dedupedSkips, belowThreshold, missingQuote, tickers: tickerList.length, users: interested.length }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
