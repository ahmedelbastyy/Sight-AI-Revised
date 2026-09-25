import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

// Multiple Finnhub news categories to rotate through for variety
const NEWS_CATEGORIES = ['general', 'forex', 'crypto', 'merger'];

interface FinnhubArticle {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const finnhubKey = Deno.env.get('FINNHUB_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const aiApiKey = Deno.env.get('ONSPACE_AI_API_KEY');
    const aiBaseUrl = Deno.env.get('ONSPACE_AI_BASE_URL');

    if (!finnhubKey) {
      return new Response(JSON.stringify({ error: 'Finnhub API key not configured', articles: [] }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Parse request body
    let forceRefresh = false;
    let excludeHeadlines: string[] = [];
    try {
      const body = await req.json();
      forceRefresh = body?.forceRefresh === true;
      if (Array.isArray(body?.excludeHeadlines)) {
        excludeHeadlines = body.excludeHeadlines.map((h: string) => String(h).toLowerCase().trim());
      }
    } catch {}

    const today = new Date().toISOString().split('T')[0];

    // If NOT force refresh, check DB cache first
    if (!forceRefresh) {
      const { data: existingNews, error: dbError } = await supabaseAdmin
        .from('daily_news')
        .select('*')
        .eq('fetched_date', today)
        .order('published_at', { ascending: false });

      if (!dbError && existingNews && existingNews.length >= 5) {
        const articles = existingNews.map((n: any) => ({
          id: n.id,
          title: n.title,
          source: n.source,
          url: n.url,
          summary: n.summary,
          sentiment: n.sentiment,
          tickers: n.tickers || [],
          published_at: n.published_at,
        }));
        return new Response(JSON.stringify({ articles, cached: true, date: today }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Fetch fresh news from Finnhub using multiple categories for variety
    // Pick a random category to get different results each time
    const categoryIndex = Math.floor(Math.random() * NEWS_CATEGORIES.length);
    const primaryCategory = NEWS_CATEGORIES[categoryIndex];
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    // Fetch from primary category
    const finnhubRes = await fetch(
      `${FINNHUB_BASE}/news?category=${primaryCategory}&minId=${Math.floor(Math.random() * 1000)}&token=${finnhubKey}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    let rawArticles: FinnhubArticle[] = [];

    if (finnhubRes.ok) {
      rawArticles = await finnhubRes.json();
    }

    // Also fetch from 'general' if primary wasn't general to get more variety
    if (primaryCategory !== 'general') {
      try {
        const controller2 = new AbortController();
        const timeout2 = setTimeout(() => controller2.abort(), 10000);
        const generalRes = await fetch(
          `${FINNHUB_BASE}/news?category=general&token=${finnhubKey}`,
          { signal: controller2.signal }
        );
        clearTimeout(timeout2);
        if (generalRes.ok) {
          const generalArticles: FinnhubArticle[] = await generalRes.json();
          rawArticles = [...rawArticles, ...generalArticles];
        }
      } catch {}
    }

    if (!finnhubRes.ok && rawArticles.length === 0) {
      console.error('Finnhub API error:', finnhubRes.status);
      // Return any existing cached news as fallback
      const { data: existingNews } = await supabaseAdmin
        .from('daily_news')
        .select('*')
        .eq('fetched_date', today)
        .order('published_at', { ascending: false });

      if (existingNews && existingNews.length > 0) {
        const articles = existingNews.map((n: any) => ({
          id: n.id, title: n.title, source: n.source, url: n.url,
          summary: n.summary, sentiment: n.sentiment, tickers: n.tickers || [],
          published_at: n.published_at,
        }));
        return new Response(JSON.stringify({ articles, cached: true, date: today }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'Finnhub API error', articles: [] }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Deduplicate by headline
    const seenHeadlines = new Set<string>();
    const excludeSet = new Set(excludeHeadlines);
    const uniqueArticles = rawArticles.filter(a => {
      const key = a.headline.toLowerCase().trim();
      if (seenHeadlines.has(key) || !a.headline) return false;
      seenHeadlines.add(key);
      return true;
    });

    // For force refresh: EXCLUDE all previously seen headlines completely to get brand new batch
    let candidateArticles: FinnhubArticle[];
    if (forceRefresh && excludeSet.size > 0) {
      // Only take articles that are NOT in the exclude set
      const freshOnly = uniqueArticles.filter(a => !excludeSet.has(a.headline.toLowerCase().trim()));
      // If we have enough fresh ones, use them. Otherwise fall back to all but shuffle heavily
      if (freshOnly.length >= 10) {
        candidateArticles = freshOnly;
      } else {
        // Not enough truly fresh articles — shuffle all for maximum variety
        candidateArticles = [...uniqueArticles];
      }
      // Shuffle for variety
      for (let i = candidateArticles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidateArticles[i], candidateArticles[j]] = [candidateArticles[j], candidateArticles[i]];
      }
    } else {
      // Sort by time for initial/non-refresh fetches
      candidateArticles = uniqueArticles.sort((a, b) => b.datetime - a.datetime);
    }

    // Take top 20 articles
    const topArticles = candidateArticles.slice(0, 20);

    if (topArticles.length === 0) {
      return new Response(JSON.stringify({ error: 'No articles from Finnhub', articles: [] }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Enrich with AI sentiment analysis if available
    let enrichedArticles: any[] = [];

    if (aiApiKey && aiBaseUrl) {
      const enrichPrompt = `You are a financial news analyst. Analyze these ${topArticles.length} news articles and provide sentiment and relevant S&P 500 ticker identification.

Articles:
${topArticles.map((a, i) => `[${i + 1}] Title: ${a.headline}\nSummary: ${a.summary || 'N/A'}\nSource: ${a.source}\nRelated: ${a.related || 'N/A'}`).join('\n\n')}

For EACH article, return a JSON object with:
- index: article number (1-based)
- sentiment: POSITIVE, NEGATIVE, or NEUTRAL based on market impact
- tickers: array of 1-3 relevant S&P 500 ticker symbols
- summary: 2-3 sentence enhanced summary with market context

SENTIMENT RULES:
- POSITIVE: Stock price likely UP (good earnings, upgrades, expansion, beat estimates)
- NEGATIVE: Stock price likely DOWN (misses, downgrades, layoffs, regulatory issues)
- NEUTRAL: No clear directional impact or mixed signals
- Be DECISIVE. At least 40% should be POSITIVE or NEGATIVE.

Return ONLY a valid JSON array. No markdown. No code fences.`;

      try {
        const aiRes = await fetch(`${aiBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${aiApiKey}`,
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: 'You are a financial news analysis API. Return ONLY valid JSON arrays.' },
              { role: 'user', content: enrichPrompt },
            ],
            temperature: 0.3,
          }),
        });

        if (aiRes.ok) {
          const aiData = await aiRes.json();
          let content = aiData.choices?.[0]?.message?.content ?? '[]';
          content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
          const firstBracket = content.indexOf('[');
          const lastBracket = content.lastIndexOf(']');
          if (firstBracket !== -1 && lastBracket !== -1) {
            content = content.substring(firstBracket, lastBracket + 1);
          }

          let enrichments: any[] = [];
          try {
            enrichments = JSON.parse(content);
            if (!Array.isArray(enrichments)) enrichments = [];
          } catch {
            try {
              const cleaned = content.replace(/[\x00-\x1F\x7F]/g, (ch: string) => ch === '\n' || ch === '\r' || ch === '\t' ? ' ' : '');
              enrichments = JSON.parse(cleaned);
              if (!Array.isArray(enrichments)) enrichments = [];
            } catch { enrichments = []; }
          }

          enrichedArticles = topArticles.map((raw, i) => {
            const enrichment = enrichments.find((e: any) => e.index === i + 1) || enrichments[i] || {};
            return {
              title: raw.headline,
              source: raw.source || 'Financial News',
              url: raw.url,
              summary: enrichment.summary || raw.summary || raw.headline,
              sentiment: ['POSITIVE', 'NEGATIVE', 'NEUTRAL'].includes(enrichment.sentiment) ? enrichment.sentiment : 'NEUTRAL',
              tickers: Array.isArray(enrichment.tickers) ? enrichment.tickers : (raw.related ? raw.related.split(',').map((t: string) => t.trim()).filter(Boolean).slice(0, 3) : []),
              published_at: new Date(raw.datetime * 1000).toISOString(),
            };
          });
        }
      } catch (e) {
        console.error('AI enrichment failed:', e);
      }
    }

    // Fallback: keyword-based sentiment if AI failed
    if (enrichedArticles.length === 0) {
      enrichedArticles = topArticles.map((raw) => {
        const text = `${raw.headline} ${raw.summary || ''}`.toLowerCase();
        const posWords = ['surge', 'soar', 'rally', 'gain', 'beat', 'upgrade', 'record', 'growth', 'strong', 'boom', 'jump', 'rise', 'profit', 'bullish', 'expand'];
        const negWords = ['crash', 'plunge', 'drop', 'fall', 'miss', 'downgrade', 'loss', 'weak', 'decline', 'cut', 'layoff', 'bear', 'fear', 'risk', 'warn', 'sell', 'slump'];
        const posScore = posWords.filter(w => text.includes(w)).length;
        const negScore = negWords.filter(w => text.includes(w)).length;
        let sentiment = 'NEUTRAL';
        if (posScore > negScore && posScore >= 1) sentiment = 'POSITIVE';
        else if (negScore > posScore && negScore >= 1) sentiment = 'NEGATIVE';

        return {
          title: raw.headline,
          source: raw.source || 'Financial News',
          url: raw.url,
          summary: raw.summary || raw.headline,
          sentiment,
          tickers: raw.related ? raw.related.split(',').map((t: string) => t.trim()).filter(Boolean).slice(0, 3) : [],
          published_at: new Date(raw.datetime * 1000).toISOString(),
        };
      });
    }

    // Only store to DB if this is NOT a forceRefresh (Pro device-local refresh)
    // Free users get their news from the DB cache which refreshes once daily at 8 AM
    if (!forceRefresh) {
      // Delete old news and replace with fresh batch
      await supabaseAdmin.from('daily_news').delete().lt('fetched_date', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
      
      // Delete existing today's news to replace with fresh batch
      await supabaseAdmin.from('daily_news').delete().eq('fetched_date', today);

      // Insert new articles
      const insertData = enrichedArticles.map(a => ({
        title: a.title,
        source: a.source,
        url: a.url,
        summary: a.summary,
        sentiment: a.sentiment,
        tickers: a.tickers,
        published_at: a.published_at,
        fetched_date: today,
      }));

      const { error: insertError } = await supabaseAdmin.from('daily_news').insert(insertData);
      if (insertError) {
        console.error('Insert error:', insertError);
      }
    }

    // Return the articles
    const responseArticles = enrichedArticles.map((a, i) => ({
      id: `finnhub-${today}-${Date.now()}-${i}`,
      ...a,
    }));

    return new Response(JSON.stringify({ articles: responseArticles, cached: false, date: today, refreshed: forceRefresh }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('fetch-news error:', error);
    return new Response(JSON.stringify({ error: String(error), articles: [] }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
