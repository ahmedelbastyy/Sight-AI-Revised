// =============================================================================
// Session 191 — market-events-worker is DISABLED.
//
// Market Open + Market Close notifications are now delivered as LOCAL
// scheduled notifications from the mobile client (see
// services/notificationService.scheduleMarketOpenClose). Local scheduling
// uses date-specific identifiers (`market-open-YYYY-MM-DD` /
// `market-close-YYYY-MM-DD`) across a rolling 14-trading-day window,
// respects the NYSE calendar including full-day holidays, and correctly
// uses the actual early-close time (13:00 ET) on official early-close
// days. iOS delivers those DATE-trigger notifications even while Sight
// is completely closed.
//
// Running this server-side worker ALONGSIDE the local scheduler produced
// duplicate deliveries at 09:30 ET open and 16:00 ET close every trading
// day (once from this worker's Expo Push and once from the locally-
// scheduled DATE-trigger notification). To eliminate that duplicate
// delivery this worker is a no-op — it returns 200 with status "disabled"
// and does not send a single push.
//
// The market_event_deliveries table is intentionally NOT dropped so any
// historical rows remain queryable for support / analytics. No new rows
// are inserted from this worker after Session 191.
// =============================================================================
import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

serve((req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  return new Response(
    JSON.stringify({
      status: 'disabled',
      reason: 'market_open_close_now_uses_local_scheduling',
      message: 'Market Open and Market Close notifications are delivered as local scheduled notifications from the mobile client. This server worker no longer sends pushes to avoid duplicate delivery.',
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
});
