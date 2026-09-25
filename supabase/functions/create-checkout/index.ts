import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { corsHeaders } from "../_shared/cors.ts";

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-CHECKOUT] ${step}${d}`);
};

const STANDARD_PRICE_ID = "price_1TGoh42NTNFyAL2HtLew41BG";
const INTRO_PRICE_ID = "price_1TIIAX2NTNFyAL2Hmr5AINrl"; // $7.99 first month

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  );

  try {
    logStep("Function started");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Authorization header not provided");

    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user?.email) throw new Error("User not authenticated or email unavailable");
    logStep("User authenticated", { userId: user.id, email: user.email });

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not set");

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    // Parse body for offer type and device ID
    let useIntroOffer = false;
    let deviceId = "";
    try {
      const body = await req.json();
      useIntroOffer = body?.offerType === 'intro';
      deviceId = body?.deviceId || "";
    } catch {}

    // Check if customer already exists
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId: string | undefined;
    let hasHadSubscription = false;
    let hasUsedTrial = false;
    let deviceUsedTrial = false;

    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Existing Stripe customer found", { customerId });

      // Check if already has active or trialing subscription
      const activeSubs = await stripe.subscriptions.list({ customer: customerId, status: "active", limit: 1 });
      const trialSubs = await stripe.subscriptions.list({ customer: customerId, status: "trialing", limit: 1 });
      if (activeSubs.data.length > 0 || trialSubs.data.length > 0) {
        logStep("User already has active subscription");
        return new Response(JSON.stringify({ error: "You already have an active subscription" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }

      // Check if customer has EVER had a subscription (including cancelled, past_due, etc.)
      const allSubs = await stripe.subscriptions.list({ customer: customerId, limit: 100 });
      const cancelledSubs = await stripe.subscriptions.list({ customer: customerId, status: "canceled", limit: 100 });
      const totalSubs = [...allSubs.data, ...cancelledSubs.data];
      
      if (totalSubs.length > 0) {
        hasHadSubscription = true;
        logStep("Customer has previous subscriptions - no trial", { count: totalSubs.length });
      }

      // Check if any previous subscription had a trial (even more precise)
      for (const sub of totalSubs) {
        if (sub.trial_start || sub.trial_end) {
          hasUsedTrial = true;
          logStep("Customer has used a trial before");
          break;
        }
      }

      // Check device-based trial tracking via customer metadata
      const customer = customers.data[0];
      const usedDevices = (customer.metadata?.trial_devices || "").split(",").filter(Boolean);
      if (deviceId && usedDevices.includes(deviceId)) {
        deviceUsedTrial = true;
        logStep("Device already used trial", { deviceId });
      }
    } else {
      // No Stripe customer yet - check if this device was used with a DIFFERENT email/customer
      // by checking all customers with this device ID in metadata
      // This prevents: create account A → use trial → delete → create account B → try trial again on same device
      if (deviceId) {
        try {
          // Search customers who have this device in their trial_devices metadata
          // Stripe search API for metadata
          const searchResult = await stripe.customers.search({
            query: `metadata["trial_devices"]~"${deviceId}"`,
            limit: 1,
          });
          if (searchResult.data.length > 0) {
            deviceUsedTrial = true;
            logStep("Device already used trial under different customer", { deviceId });
          }
        } catch (e) {
          // Search API might not be available, fall through
          logStep("Customer search fallback", { error: String(e) });
        }
      }
    }

    // Determine if trial should be offered
    const shouldOfferTrial = !hasHadSubscription && !hasUsedTrial && !deviceUsedTrial;

    // For intro offer: use the $7.99 intro price, no trial
    if (useIntroOffer) {
      logStep("Creating intro offer checkout ($7.99 first month)");

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        customer_email: customerId ? undefined : user.email,
        line_items: [{ price: INTRO_PRICE_ID, quantity: 1 }],
        mode: "subscription",
        success_url: "https://checkout.stripe.com/success",
        cancel_url: "https://checkout.stripe.com/cancel",
      });

      logStep("Intro checkout session created", { sessionId: session.id });
      return new Response(JSON.stringify({ url: session.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Standard checkout
    const subscriptionData: any = {};
    if (shouldOfferTrial) {
      subscriptionData.trial_period_days = 1;
      logStep("New customer + new device - offering 1-day free trial");
    } else {
      logStep("Trial not eligible", { hasHadSubscription, hasUsedTrial, deviceUsedTrial });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [{ price: STANDARD_PRICE_ID, quantity: 1 }],
      mode: "subscription",
      subscription_data: subscriptionData,
      success_url: "https://checkout.stripe.com/success",
      cancel_url: "https://checkout.stripe.com/cancel",
    });

    // Track device for trial prevention on the customer
    // Do this after session creation so the customer exists
    if (deviceId && shouldOfferTrial) {
      try {
        // The customer may have been created by Stripe during checkout session creation
        // We need to track the device on whatever customer is associated
        const targetCustomerId = customerId || session.customer as string;
        if (targetCustomerId) {
          let existingDevices: string[] = [];
          if (customerId) {
            const customer = customers.data[0];
            existingDevices = (customer.metadata?.trial_devices || "").split(",").filter(Boolean);
          }
          if (!existingDevices.includes(deviceId)) {
            existingDevices.push(deviceId);
            await stripe.customers.update(targetCustomerId, {
              metadata: { trial_devices: existingDevices.join(",") },
            });
            logStep("Tracked device for trial prevention", { deviceId, customerId: targetCustomerId });
          }
        }
      } catch (e) {
        logStep("Device tracking error (non-fatal)", { error: String(e) });
      }
    }

    logStep("Checkout session created", { sessionId: session.id, trialOffered: shouldOfferTrial });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("Error", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
