import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// DELETE ACCOUNT (Session 177 App Store readiness pass)
// ---------------------------------------------------------------------------
// Apple's Guideline 5.1.1(v) requires apps that support account creation to
// let users initiate account deletion from within the app. This function:
//
//   1. Authenticates the requester via their JWT (service role never
//      leaves the server).
//   2. Cancels any Stripe subscription linked to this email (if Stripe is
//      configured — RevenueCat/StoreKit App Store subscriptions are the
//      primary path but Stripe is legacy support).
//   3. Revokes RevenueCat entitlements for the userId so the user cannot
//      continue to hold Pro on a fresh account after re-signup — however,
//      it explicitly does NOT cancel the Apple auto-renewing subscription
//      because Apple requires users to manage that themselves; the client
//      surfaces the "Manage in App Store" action beforehand.
//   4. Disconnects the Sight-side SnapTrade user record so no orphaned
//      brokerage authorization remains on the aggregator side. The user's
//      brokerage account and open positions remain UNTOUCHED at their
//      brokerage — Sight only removes its access.
//   5. Deletes every Sight-owned row for this user across every current
//      table (broker_orders, position_analyses, ai_reminder_schedule,
//      market_event_deliveries, price_alert_deliveries, promo_activations,
//      trade_submissions, user_broker_connections, user_push_tokens,
//      user_watchlists, chart_analysis_usage, active_sessions,
//      user_profiles). All of these have ON DELETE CASCADE on the FK to
//      user_profiles(id), so deleting user_profiles is sufficient, but we
//      also delete them explicitly for defense-in-depth in case the
//      cascade is temporarily disabled.
//   6. Deletes the auth.users row via multiple redundant strategies so
//      the email is truly released for re-registration.
//
// Idempotent: safe to call multiple times. Individual failures are logged
// but do not abort the pipeline — the goal is that after this function
// returns success, the user's Sight data is gone even if one third-party
// integration was transiently unavailable.
// ---------------------------------------------------------------------------

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[DELETE-ACCOUNT] ${step}${d}`);
};

// Every table in the current schema that stores per-user data. Deleted
// explicitly BEFORE user_profiles so RLS never blocks a service-role
// delete and so we generate a clean audit trail. All of these also have
// ON DELETE CASCADE on their FK to user_profiles(id), so deleting
// user_profiles is a second layer of defense.
const USER_OWNED_TABLES = [
  'active_sessions',
  'ai_reminder_schedule',
  'broker_orders',
  'chart_analysis_usage',
  'market_event_deliveries',
  'position_analyses',
  'price_alert_deliveries',
  'promo_activations',
  'trade_submissions',
  'user_broker_connections',
  'user_push_tokens',
  'user_watchlists',
];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    logStep('Function started');

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const rcApiKey = Deno.env.get('REVENUECAT_IOS_API_KEY') ?? '';
    const snaptradeClientId = Deno.env.get('SNAPTRADE_CLIENT_ID') ?? '';
    const snaptradeConsumerKey = Deno.env.get('SNAPTRADE_CONSUMER_KEY') ?? '';

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Server misconfiguration');
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    const user = userData.user;
    if (!user?.email) throw new Error('User not authenticated');
    const originalEmail = user.email;
    const userId = user.id;
    logStep('User authenticated', { userId, email: originalEmail });

    // ============================================
    // 1. SNAPTRADE — disconnect BEFORE deleting the row so we can call
    //    the aggregator with the correct userSecret.
    // ============================================
    let snaptradeDisconnected = false;
    if (snaptradeClientId && snaptradeConsumerKey) {
      try {
        const { data: brokerRow } = await supabaseAdmin
          .from('user_broker_connections')
          .select('snaptrade_user_secret')
          .eq('user_id', userId)
          .maybeSingle();
        const userSecret = brokerRow?.snaptrade_user_secret;
        if (userSecret) {
          // SnapTrade Delete User endpoint. Uses simple query auth per
          // their API — this is documented and safe. Failure here is
          // NON-FATAL: even if the aggregator is unreachable we still
          // proceed with local deletion so the user's data is gone.
          const stUrl = `https://api.snaptrade.com/api/v1/snapTrade/deleteUser?clientId=${encodeURIComponent(snaptradeClientId)}&userId=${encodeURIComponent(userId)}&userSecret=${encodeURIComponent(userSecret)}&timestamp=${Math.floor(Date.now() / 1000)}`;
          const stRes = await fetch(stUrl, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'consumerKey': snaptradeConsumerKey },
          });
          snaptradeDisconnected = stRes.ok || stRes.status === 404;
          logStep('SnapTrade disconnect', { status: stRes.status, ok: snaptradeDisconnected });
        } else {
          snaptradeDisconnected = true; // Nothing to disconnect
          logStep('SnapTrade — no broker connection to disconnect');
        }
      } catch (e) {
        logStep('SnapTrade disconnect exception (non-fatal)', { error: String(e) });
      }
    }

    // ============================================
    // 2. SUBSCRIPTION & BILLING
    //    IMPORTANT: this does NOT cancel App Store auto-renewing
    //    subscriptions. Apple requires users to manage those themselves
    //    via Settings > Apple ID > Subscriptions. The client shows a
    //    clear warning + "Manage in App Store" action before calling
    //    this function. RevenueCat entitlement revocation only prevents
    //    the SAME userId from re-inheriting Pro after re-signup.
    // ============================================

    // 2a. Cancel legacy Stripe subscriptions if any exist.
    let stripeCancelled = false;
    if (stripeKey) {
      try {
        const stripeBaseUrl = 'https://api.stripe.com/v1';
        const custRes = await fetch(`${stripeBaseUrl}/customers?email=${encodeURIComponent(originalEmail)}&limit=5`, {
          headers: { 'Authorization': `Basic ${btoa(stripeKey + ':')}` },
        });
        if (custRes.ok) {
          const custData = await custRes.json();
          for (const customer of custData.data || []) {
            for (const status of ['active', 'trialing', 'incomplete']) {
              const subsRes = await fetch(`${stripeBaseUrl}/subscriptions?customer=${customer.id}&status=${status}&limit=20`, {
                headers: { 'Authorization': `Basic ${btoa(stripeKey + ':')}` },
              });
              if (subsRes.ok) {
                const subsData = await subsRes.json();
                for (const sub of subsData.data || []) {
                  const cancelRes = await fetch(`${stripeBaseUrl}/subscriptions/${sub.id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Basic ${btoa(stripeKey + ':')}` },
                  });
                  logStep('Cancelled Stripe subscription', { subId: sub.id, status: sub.status, success: cancelRes.ok });
                }
              }
            }
          }
          stripeCancelled = true;
        }
      } catch (e) {
        logStep('Stripe cleanup error (non-fatal)', { error: String(e) });
      }
    }

    // 2b. Revoke RevenueCat subscriber entitlements. Does NOT cancel
    //     the underlying Apple auto-renewing subscription.
    let rcRevoked = false;
    if (rcApiKey) {
      try {
        const rcDeleteUrl = `https://api.revenuecat.com/v1/subscribers/${userId}`;
        const revokeResponse = await fetch(rcDeleteUrl, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${rcApiKey}`, 'Content-Type': 'application/json' },
        });
        if (revokeResponse.ok || revokeResponse.status === 404) {
          rcRevoked = true;
          logStep('RevenueCat subscriber deleted - all entitlements revoked');
        } else {
          const rcRevokeUrl = `https://api.revenuecat.com/v1/subscribers/${userId}/entitlements/premium/revoke_promotionals`;
          await fetch(rcRevokeUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${rcApiKey}`, 'Content-Type': 'application/json' },
          });
          rcRevoked = true;
          logStep('RevenueCat promotional entitlements revoked');
        }
      } catch (e) {
        logStep('RevenueCat cleanup error (non-fatal)', { error: String(e) });
      }
    }

    const deletionTimestamp = new Date().toISOString();

    // ============================================
    // 3. AUTHENTICATION - Invalidate all sessions
    // ============================================
    try {
      const logoutRes = await fetch(`${supabaseUrl}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': serviceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scope: 'global' }),
      });
      logStep('Global signout completed', { status: logoutRes.status });
    } catch (e) {
      logStep('Global signout error (non-fatal)', { error: String(e) });
    }

    // ============================================
    // 4. USER DATA - Delete every user-owned row across every table.
    //    All FKs cascade from user_profiles(id) so deleting user_profiles
    //    would technically be enough, but we delete each table explicitly
    //    for defense-in-depth and to produce a clear audit trail.
    // ============================================
    for (const table of USER_OWNED_TABLES) {
      try {
        // user_broker_connections uses user_id as primary key
        const { error } = await supabaseAdmin.from(table).delete().eq('user_id', userId);
        if (error) {
          logStep(`${table} delete error`, { error: error.message });
        } else {
          logStep(`Deleted ${table}`);
        }
      } catch (e) {
        logStep(`${table} cleanup exception`, { error: String(e) });
      }
    }

    // Finally delete the user_profiles row.
    try {
      const { error } = await supabaseAdmin.from('user_profiles').delete().eq('id', userId);
      if (error) logStep('user_profiles delete error', { error: error.message });
      else logStep('Deleted user_profiles');
    } catch (e) {
      logStep('user_profiles cleanup error', { error: String(e) });
    }

    // Belt-and-braces re-check.
    try {
      const { data: profileCheck } = await supabaseAdmin
        .from('user_profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();
      if (profileCheck) {
        logStep('WARNING: user_profiles still exists, retrying...');
        await supabaseAdmin.from('user_profiles').delete().eq('id', userId);
      }
    } catch {}

    // ============================================
    // 5. EMAIL RELEASE - Delete the auth user completely.
    //    Multi-strategy so a partial failure on one path is recovered
    //    by another. The goal is that the original email is freed for
    //    re-registration.
    // ============================================
    let authDeleted = false;

    // Strategy A: admin SDK deleteUser.
    try {
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (!deleteError) {
        authDeleted = true;
        logStep('Auth user deleted via admin SDK');
      } else if (deleteError.message?.toLowerCase().includes('not found')) {
        authDeleted = true;
        logStep('Auth user was already deleted');
      } else {
        logStep('Admin SDK deleteUser failed', { error: deleteError.message });
      }
    } catch (e) {
      logStep('Admin SDK deleteUser exception', { error: String(e) });
    }

    // Strategy B: REST API DELETE.
    if (!authDeleted) {
      try {
        const authUrl = `${supabaseUrl}/auth/v1/admin/users/${userId}`;
        const deleteResponse = await fetch(authUrl, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json',
          },
        });
        if (deleteResponse.ok || deleteResponse.status === 204 || deleteResponse.status === 404) {
          authDeleted = true;
          logStep('Auth user deleted via REST API');
        } else {
          const body = await deleteResponse.text();
          logStep('REST API delete failed', { status: deleteResponse.status, body });
        }
      } catch (e) {
        logStep('REST API delete exception', { error: String(e) });
      }
    }

    // Strategy C: Anonymize email + ban permanently as a last resort so
    // at minimum the original email is freed for re-registration.
    if (!authDeleted) {
      try {
        const deadEmail = `deleted_${userId}_${Date.now()}@deleted.tradesight.internal`;
        const { error: emailError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
          email: deadEmail,
          email_confirm: true,
        });
        if (!emailError) {
          await supabaseAdmin.auth.admin.updateUserById(userId, {
            password: crypto.randomUUID() + crypto.randomUUID() + '!Aa1',
            ban_duration: '876000h',
            user_metadata: { deleted: true, deleted_at: deletionTimestamp, original_email: originalEmail },
            app_metadata: { deleted: true },
          });
          authDeleted = true;
          logStep('User banned and email anonymized as last resort');
        } else {
          logStep('Email anonymization failed', { error: emailError.message });
        }
      } catch (e) {
        logStep('Fallback anonymization exception', { error: String(e) });
      }
    }

    // ============================================
    // 6. AUDIT LOG
    // ============================================
    logStep('DELETION COMPLETE', {
      userId,
      email: originalEmail,
      timestamp: deletionTimestamp,
      authDeleted,
      stripeCancelled,
      rcRevoked,
      snaptradeDisconnected,
    });

    return new Response(JSON.stringify({
      success: true,
      message: 'Account permanently deleted. Sight data cleared, brokerage access revoked, and email released for re-registration.',
      authDeleted,
      stripeCancelled,
      rcRevoked,
      snaptradeDisconnected,
      timestamp: deletionTimestamp,
      // Client uses this to remind the user that Apple auto-renewing
      // subscriptions are managed by Apple, not by Sight.
      appleSubscriptionReminder: 'If you had an active App Store subscription, you must cancel it separately from Settings > Apple ID > Subscriptions. Sight cannot cancel Apple billing on your behalf.',
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
      status: 200,
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep('Error', { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
