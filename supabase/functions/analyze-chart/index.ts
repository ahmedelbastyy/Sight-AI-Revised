import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * analyze-chart — Chart Scanner (Session 119 rewrite)
 * =============================================================================
 * PURPOSE CHANGE (spec §8):
 *   Chart Scan is NOT an actionable trade recommender. It is an EDUCATIONAL
 *   analyst that explains what the chart is showing:
 *     • Trend / market structure
 *     • Support / resistance
 *     • Momentum, volume, volatility
 *     • Chart patterns (breakouts, breakdowns, reversals, consolidations)
 *     • Candlestick patterns
 *     • Moving averages
 *     • Potential entry / exit ZONES traders would watch (NOT a BUY/SHORT)
 *     • Where reliable knowledge exists: news / fundamentals / options / order-flow context
 *
 * The AI must NOT tell the user to buy or short. That belongs to AI Moves.
 * The user will decide themselves whether to log a trade after reading the analysis.
 * =============================================================================
 */

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[ANALYZE-CHART] ${step}${d}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    logStep("Function started");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Authorization header not provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated or email unavailable");

    const { imageBase64 } = await req.json();
    if (!imageBase64) throw new Error("No image provided");

    // Usage limit check (unchanged)
    const ANALYSIS_LIMIT = 2000;
    const now = new Date();
    const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const { data: usageData } = await supabaseClient
      .from('chart_analysis_usage')
      .select('analysis_count, updated_at')
      .eq('user_id', user.id)
      .maybeSingle();
    let currentCount = usageData?.analysis_count ?? 0;
    if (usageData?.updated_at) {
      const lastUpdate = new Date(usageData.updated_at);
      const lastMonth = `${lastUpdate.getUTCFullYear()}-${String(lastUpdate.getUTCMonth() + 1).padStart(2, '0')}`;
      if (lastMonth !== currentMonth) {
        currentCount = 0;
        await supabaseClient.from('chart_analysis_usage')
          .update({ analysis_count: 0, updated_at: now.toISOString() }).eq('user_id', user.id);
      }
    }
    if (currentCount >= ANALYSIS_LIMIT) {
      return new Response(
        JSON.stringify({ error: 'Error: image limit reached' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
      );
    }

    const apiKey = Deno.env.get("ONSPACE_AI_API_KEY");
    const baseUrl = Deno.env.get("ONSPACE_AI_BASE_URL");
    if (!apiKey || !baseUrl) throw new Error("OnSpace AI not configured");

    const systemPrompt = `You are TradeSight's Chart Analyst — an educational technical analysis expert. Your job is to EXPLAIN what a chart is showing so the user understands the setup. You do NOT tell the user to BUY or SHORT. Actionable trade recommendations come from the separate AI Moves system, not from Chart Scan.

============================================================
DATA INTEGRITY RULES
============================================================
1. NEVER fabricate specific news headlines, analyst calls, GEX values, earnings dates, or institutional flows you cannot verify from your training knowledge.
2. If a category is unavailable, omit it from your response — do NOT invent it.
3. Base your analysis on what is actually VISIBLE in the chart image plus reliable general knowledge of the ticker (if identified).

============================================================
YOUR TASK
============================================================
Step 1 — Chart validation:
If the image is NOT a stock or financial chart, respond EXACTLY with:
{"isChart": false, "error": "Chart not recognized. Please upload an image of a stock or financial chart."}

Step 2 — If it IS a chart, produce an educational analysis covering:

A) Chart Context
   • Ticker if identifiable (or "Unknown")
   • Timeframe estimate (intraday / daily / weekly)
   • Overall market structure (uptrend / downtrend / consolidation / reversal)

B) Trend & Structure
   • Higher-highs / higher-lows OR lower-highs / lower-lows
   • Moving average alignment if visible
   • Recent notable price action

C) Support & Resistance
   • Key levels visible on the chart (2-4 levels)
   • Whether price is near a major level right now

D) Chart Patterns & Strategies Visible
   • Named patterns present (head & shoulders, double top/bottom, flag, pennant, triangle, cup & handle, wedge, breakout, breakdown, consolidation, reversal, etc.)
   • Candlestick patterns worth noting
   • What TRADERS TYPICALLY WATCH FOR at this setup — described educationally, NOT as a recommendation

E) Momentum & Volume
   • Visible momentum characteristics
   • Volume behavior if bars are shown
   • Volatility observations

F) Broader Context (only if you have reliable general knowledge about the identified ticker — otherwise OMIT):
   • News / catalysts context (well-established only)
   • Fundamentals context (well-established only)
   • Options / gamma landscape (major tickers only)
   • Sector / macro conditions

G) Potential Zones (educational, NOT a trade call)
   • Areas that would interest bullish traders (e.g. "$205 acts as a potential resistance area")
   • Areas that would interest bearish traders
   • These are OBSERVATIONS about levels, NOT instructions to trade

Respond with ONLY valid JSON in this shape:
{
  "isChart": true,
  "ticker": "SYMBOL or Unknown",
  "timeframe": "Intraday" | "Daily" | "Weekly" | "Unknown",
  "structure": "Uptrend" | "Downtrend" | "Consolidation" | "Reversal" | "Mixed",
  "summary": "One paragraph plain-English overview of what the chart is showing.",
  "trendNotes": "Trend & structure observations.",
  "keyLevels": [{ "label": "Resistance" | "Support" | "Pivot", "price": number }],
  "patterns": ["pattern name 1", "pattern name 2"],
  "candlestickNotes": "Notable candlestick behavior, or empty string.",
  "momentumNotes": "Momentum / volume observations.",
  "context": "Broader context (news/fundamentals/options/sector) only if reliably known. Otherwise empty string.",
  "bullishFactors": ["what bullish traders would watch"],
  "bearishFactors": ["what bearish traders would watch"],
  "educationalNote": "One-sentence reminder that this is analysis, not a recommendation."
}

DO NOT include: BUY / SHORT / actionable direction / confidence percentage / take profit / stop loss / entry price. Those belong to AI Moves, not Chart Scan.`;

    const models = [
      "google/gemini-2.5-flash",
      "google/gemini-2.5-flash-lite",
      "openai/gpt-5-mini",
    ];

    let aiResponse: Response | null = null;
    let lastError = "";

    for (const model of models) {
      logStep("Trying model", { model });
      try {
        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: [
                  { type: "text", text: "Analyze this chart image educationally. Identify the stock if possible and explain what the chart is showing. Do NOT recommend a BUY or SHORT. Respond ONLY with valid JSON." },
                  { type: "image_url", image_url: { url: imageBase64 } },
                ],
              },
            ],
            temperature: 0.3,
          }),
        });

        if (resp.ok) {
          aiResponse = resp;
          break;
        } else {
          const errText = await resp.text();
          lastError = `${model}: ${errText}`;
          logStep("Model failed, trying next", { model, status: resp.status });
        }
      } catch (e) {
        lastError = `${model}: ${String(e)}`;
      }
    }

    if (!aiResponse) throw new Error(`All AI models failed. Last error: ${lastError}`);

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content ?? "";

    let analysis;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) analysis = JSON.parse(jsonMatch[0]);
      else throw new Error("No JSON found in response");
    } catch (parseErr) {
      analysis = {
        isChart: false,
        error: "Chart not recognized. Please upload a clearer image of a stock chart.",
      };
    }

    if (analysis.isChart) {
      try {
        if (usageData) {
          await supabaseClient.from('chart_analysis_usage')
            .update({ analysis_count: currentCount + 1, updated_at: new Date().toISOString() })
            .eq('user_id', user.id);
        } else {
          await supabaseClient.from('chart_analysis_usage')
            .insert({ user_id: user.id, analysis_count: 1 });
        }
      } catch {}
    }

    return new Response(JSON.stringify(analysis), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("Error", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});
