// =============================================================================
// Session 188 \u2014 verify-promo-code is DISABLED.
//
// Apple's App Review rejected custom promo-code unlock paths for Pro
// entitlement. The Sight-owned reusable promo code (RevenueCatRocks67)
// and every custom Pro-unlock path from a Supabase Edge Function are
// permanently removed from the shipping app. This function now returns
// a definitive rejection for every request so any lingering client that
// still hits this endpoint (older TestFlight builds, etc.) receives a
// clear "not supported" response rather than silently granting Pro.
//
// The promo_activations table is intentionally NOT dropped in this
// session so historical redemption records remain queryable for support.
// Any active promotional_activations rows remain valid until their
// existing expires_at timestamp, but NO new activation can be created
// through this function.
//
// Legitimate Sight Pro unlock paths after Session 188:
//   \u2022 StoreKit purchase (App Store subscription products)
//   \u2022 Restore Purchases (RevenueCat receipt validation)
// =============================================================================
import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  return new Response(
    JSON.stringify({
      valid: false,
      error: 'Promo code redemption is no longer supported. Please subscribe through the App Store.',
      reason: 'disabled_by_app_review',
    }),
    {
      status: 410, // Gone \u2014 explicitly signals the endpoint has been permanently removed.
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
});
