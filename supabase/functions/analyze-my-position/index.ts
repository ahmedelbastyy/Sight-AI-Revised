import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * analyze-my-position — Personalized AI position monitoring (Session 119)
 * =============================================================================
 * Called from the Stock Details page "Analyze My Position" button.
 * Takes ONE trade + current price series and returns a fresh personalized
 * verdict considering:
 *   • Current technical setup
 *   • Well-established news / fundamentals / options context
 *   • Change since the trade was opened
 *   • Original AI reasoning (if the trade came from an AI Move or Chart Scan)
 *
 * Verdict is one of:
 *   "continue_holding" | "consider_taking_profit" | "consider_exiting"
 *   | "setup_weakening" | "setup_strengthened" | "info_changed"
 *
 * The AI is instructed NEVER to fabricate news, GEX, order flow, or specific
 * analyst calls it cannot verify.
 * =============================================================================
 */

async function fetchYahooChart(symbol: string): Promise<{ price: number; prices: number[]; changePercent: number } | null> {
  for (const base of [
    'https://query1.finance.yahoo.com/v8/finance/chart',
    'https://query2.finance.yahoo.com/v8/finance/chart',
  ]) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);
      const res = await fetch(`${base}/${symbol}?interval=1d&range=2mo`, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result) continue;
      const meta = result.meta;
      const price = meta.regularMarketPrice ?? 0;
      const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
      const closes: number[] = (result.indicators?.quote?.[0]?.close ?? []).filter((c: any) => c != null && typeof c === 'number');
      if (price === 0 || closes.length < 10) continue;
      const changePercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
      return { price, prices: closes, changePercent };
    } catch { continue; }
  }
  return null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Authorization header not provided');
    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    const user = userData.user;
    if (!user) throw new Error('User not authenticated');

    const {
      ticker, position, entryPrice, shares, takeProfit, stopLoss,
      entryDate, source, aiContext, tradeId, currentPrice: clientCurrentPrice,
    } = await req.json();

    // Session 205 — takeProfit / stopLoss are now OPTIONAL so this endpoint
    // can analyze positions imported directly from a connected brokerage
    // (which may not carry Sight-defined bracket levels). The AI prompt
    // downgrades gracefully when no TP / SL is provided.
    if (!ticker || !position || !entryPrice) {
      throw new Error('Missing required trade fields');
    }

    // Fetch fresh market data
    const chart = await fetchYahooChart(ticker);
    if (!chart) throw new Error(`Could not fetch current data for ${ticker}`);
    const currentPrice = chart.price;
    const recentPrices = chart.prices.slice(-30);
    const priceSeries = recentPrices.map(p => p.toFixed(2)).join(', ');

    // Compute basic P/L for the AI's context
    const isLong = position === 'long';
    const safeShares = Number(shares) > 0 ? Number(shares) : 1;
    const pnl = isLong ? (currentPrice - entryPrice) * safeShares : (entryPrice - currentPrice) * safeShares;
    const pnlPercent = (pnl / (entryPrice * safeShares)) * 100;
    const hoursHeld = entryDate ? Math.max(0, (Date.now() - new Date(entryDate).getTime()) / (1000 * 60 * 60)) : 0;
    const hasTpSl = Number(takeProfit) > 0 && Number(stopLoss) > 0;

    const apiKey = Deno.env.get('ONSPACE_AI_API_KEY') ?? '';
    const baseUrl = Deno.env.get('ONSPACE_AI_BASE_URL') ?? '';
    if (!apiKey || !baseUrl) throw new Error('OnSpace AI not configured');

    const systemPrompt = `You are TradeSight's Personalized Position Analyst. A user has an ACTIVE trade you must analyze RIGHT NOW.

CRITICAL RULES:
1. NEVER fabricate news, analyst calls, GEX values, earnings dates, order-flow, or institutional flows you cannot verify.
2. If a category is unavailable, do NOT mention it. Omission > fabrication.
3. Base your verdict on: current technical setup + well-established knowledge + change since trade was opened + the original AI setup (if provided).
4. This is NOT a generic buy/hold/sell rating — it is a PERSONALIZED analysis of THIS SPECIFIC user's trade.

Return a verdict from:
   "continue_holding"       — setup remains on track, no change of thesis
   "consider_taking_profit" — trade is profitable and momentum may be topping/bottoming
   "consider_exiting"       — strong reason to exit before hitting SL
   "setup_weakening"        — evidence has weakened but no urgent exit
   "setup_strengthened"     — evidence now stronger than original setup
   "info_changed"           — new information materially changed the picture
   "insufficient_data"      — you cannot form an 85%-confident verdict from what you can actually verify

CRITICAL CONFIDENCE RULE:
   • You MUST be at least 85% confident before returning any verdict OTHER than "insufficient_data".
   • If your best-guess confidence in the recommendation is below 85%, you MUST return "insufficient_data" with a plain-English explanation of what you cannot verify.
   • Never inflate confidence to make the answer feel more certain.

Respond ONLY with valid JSON:
{
  "verdict": one of the above,
  "confidence": integer 0-100 representing how confident you are in the verdict,
  "headline": "Short 1-line headline. Use action-oriented wording like 'Trade progressing toward Take Profit', 'Momentum weakening — consider taking profit', 'Warranting an exit — stop loss zone approaching', or 'Cannot confidently recommend an action right now.'",
  "summary": "Two short paragraphs. Paragraph 1: what you can VERIFY about the current setup (technicals, momentum, well-known company fundamentals). Paragraph 2: what this specifically means for THIS user's trade.",
  "factors": ["Bullet point 1", "Bullet point 2", "Bullet point 3"],
  "nextSteps": ["1-2 short, concrete actions the user can take. Example: 'Watch for a break above $205 in the next 1-2 sessions' or 'Move stop loss up to lock in $80 profit'"]
}`;

    const originalContext = source === 'broker'
      ? 'This position was imported directly from the connected brokerage account. There is no Sight-defined Take Profit / Stop Loss, so focus your analysis on whether the current price action, trend, and well-established company context support continuing to hold, taking profit, or exiting.'
      : aiContext ? `
Original trade source: ${source ?? 'manual'}
${aiContext.reasoning ? `Original AI reasoning: "${aiContext.reasoning}"` : ''}
${aiContext.confidence ? `Original confidence: ${aiContext.confidence}%` : ''}
${aiContext.originalEntry ? `Original entry recommended: $${aiContext.originalEntry}` : ''}` : 'Trade was manually logged (no original AI setup).';

    const tpSlBlock = hasTpSl
      ? `
Take Profit: $${Number(takeProfit).toFixed(2)}
Stop Loss: $${Number(stopLoss).toFixed(2)}`
      : '';

    const userPrompt = `Analyze this active trade:

Ticker: ${ticker}
Direction: ${position === 'long' ? 'LONG' : 'SHORT'}
Shares: ${safeShares}
Entry price: $${Number(entryPrice).toFixed(2)}
Current price: $${currentPrice.toFixed(2)}${tpSlBlock}
Unrealized P/L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)
Time in trade: ${hoursHeld.toFixed(1)} hours
Today's stock change: ${chart.changePercent.toFixed(2)}%
Last 30 daily closes: ${priceSeries}
${originalContext}

Provide a personalized analysis. ${hasTpSl ? 'Does the setup still hold? Is P/L strong enough to consider taking profit? Has anything changed?' : 'Is this position looking healthy? Should the user continue holding or consider exiting? What factors support your verdict?'}`;

    const models = ['google/gemini-2.5-flash', 'openai/gpt-5-mini', 'google/gemini-2.5-flash-lite'];
    let parsed: any = null;
    for (const model of models) {
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
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
        if (!res.ok) continue;
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content ?? '';
        const match = content.match(/\{[\s\S]*\}/);
        if (match) { parsed = JSON.parse(match[0]); break; }
      } catch { continue; }
    }

    if (!parsed) throw new Error('AI analysis failed');

    const validVerdicts = ['continue_holding', 'consider_taking_profit', 'consider_exiting', 'setup_weakening', 'setup_strengthened', 'info_changed', 'insufficient_data'];
    let verdict = validVerdicts.includes(parsed.verdict) ? parsed.verdict : 'insufficient_data';
    const rawConfidence = Number(parsed.confidence);
    const confidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(100, Math.round(rawConfidence))) : 0;
    // Enforce the 85% floor server-side too. If the model returned a
    // real verdict but couldn't back it with 85% confidence, downgrade
    // to insufficient_data so the client never surfaces a low-confidence
    // recommendation as if it were actionable.
    if (verdict !== 'insufficient_data' && confidence < 85) {
      verdict = 'insufficient_data';
    }

    const result = {
      verdict,
      confidence,
      headline: String(parsed.headline ?? '').slice(0, 200),
      summary: String(parsed.summary ?? '').slice(0, 1400),
      factors: Array.isArray(parsed.factors) ? parsed.factors.slice(0, 6).map((f: any) => String(f).slice(0, 200)) : [],
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps.slice(0, 3).map((f: any) => String(f).slice(0, 200)) : [],
      currentPrice,
      pnl: Number(pnl.toFixed(2)),
      pnlPercent: Number(pnlPercent.toFixed(2)),
      analyzedAt: new Date().toISOString(),
    };

    // Persist for history (best-effort, non-blocking on failure)
    try {
      await supabaseClient.from('position_analyses').insert({
        user_id: user.id,
        trade_id: tradeId ?? '',
        ticker,
        verdict: result.verdict,
        summary: result.summary,
        factors: result.factors,
      });
    } catch {}

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message ?? String(e) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
    );
  }
});
