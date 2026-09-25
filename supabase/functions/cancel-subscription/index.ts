import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { corsHeaders } from "../_shared/cors.ts";

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CANCEL-SUBSCRIPTION] ${step}${d}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not set");

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
    logStep("User authenticated", { userId: user.id, email: user.email });

    const body = await req.json().catch(() => ({}));
    const { action } = body; // 'cancel' or 'resubscribe'

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (customers.data.length === 0) {
      throw new Error("No Stripe customer found for this account");
    }

    const customerId = customers.data[0].id;
    logStep("Stripe customer found", { customerId });

    // Get all subscriptions
    const activeSubs = await stripe.subscriptions.list({ customer: customerId, status: "active", limit: 5 });
    const trialSubs = await stripe.subscriptions.list({ customer: customerId, status: "trialing", limit: 5 });
    const allSubs = [...activeSubs.data, ...trialSubs.data];

    if (action === 'cancel') {
      if (allSubs.length === 0) {
        throw new Error("No active subscription found to cancel");
      }

      // Cancel at period end (user keeps access until end of billing period)
      const subscription = allSubs[0];
      const updated = await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: true,
      });

      logStep("Subscription set to cancel at period end", {
        subscriptionId: updated.id,
        cancelAt: new Date(updated.current_period_end * 1000).toISOString(),
      });

      return new Response(JSON.stringify({
        success: true,
        message: "Subscription will be cancelled at the end of your billing period",
        cancel_at: new Date(updated.current_period_end * 1000).toISOString(),
        status: updated.status,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });

    } else if (action === 'resubscribe') {
      // Undo cancellation if subscription is still active but set to cancel
      if (allSubs.length === 0) {
        throw new Error("No active subscription found");
      }

      const subscription = allSubs[0];
      if (!subscription.cancel_at_period_end) {
        return new Response(JSON.stringify({
          success: true,
          message: "Subscription is already active",
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      const updated = await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: false,
      });

      logStep("Subscription reactivated", { subscriptionId: updated.id });

      return new Response(JSON.stringify({
        success: true,
        message: "Subscription has been reactivated",
        status: updated.status,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });

    } else {
      // Just return subscription info
      if (allSubs.length === 0) {
        return new Response(JSON.stringify({
          has_subscription: false,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      const sub = allSubs[0];
      return new Response(JSON.stringify({
        has_subscription: true,
        status: sub.status,
        cancel_at_period_end: sub.cancel_at_period_end,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        created: new Date(sub.created * 1000).toISOString(),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("Error", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
