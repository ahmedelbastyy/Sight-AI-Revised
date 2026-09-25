// send-push-notification
// =============================================================================
// Delivers a push notification via Expo Push Service (which fans out to APNs
// on iOS and FCM on Android). Reaches the device even when the TradeSight app
// is completely closed.
//
// Call pattern (client, from services/notificationService.ts):
//   supabase.functions.invoke('send-push-notification', {
//     body: { userId, title, body, data, sound?, badge? }
//   })
//
// Security model:
//   • User JWT authenticated calls can only send push to their OWN userId.
//     If `userId` is omitted, it defaults to the caller. If it is set to
//     another user's id, the call is rejected (403).
//   • Service role calls (Authorization header equals SUPABASE_SERVICE_ROLE_KEY)
//     can send to any userId or supply explicit tokens[]. This is intended for
//     future pg_cron / server-side detection jobs.
//
// Invalid-token cleanup: any expo_push_token returned as DeviceNotRegistered
// by Expo Push Service is automatically deleted from user_push_tokens so we
// don't keep sending to dead tokens.
// =============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { corsHeaders } from "../_shared/cors.ts";

const EXPO_PUSH_API = "https://exp.host/--/api/v2/push/send";

const log = (step: string, details?: unknown) => {
  const d = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[SEND-PUSH] ${step}${d}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    log("Function started");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Identify caller: user JWT or service role
    const authHeader = req.headers.get("Authorization") ?? "";
    const rawToken = authHeader.replace("Bearer ", "").trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const isServiceCall = rawToken.length > 0 && rawToken === serviceKey;

    let callerUserId: string | null = null;
    if (!isServiceCall && rawToken) {
      try {
        const { data: userData } = await supabaseAdmin.auth.getUser(rawToken);
        callerUserId = userData?.user?.id ?? null;
      } catch {
        callerUserId = null;
      }
    }

    if (!isServiceCall && !callerUserId) {
      log("Unauthorized — no valid auth token");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    let userId: string | undefined = body.userId;
    let explicitTokens: string[] | undefined = body.tokens;
    const { title, body: msgBody, data, sound = "default", badge } = body ?? {};

    if (!title || !msgBody) {
      return new Response(
        JSON.stringify({ error: "title and body are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Enforce user-scope for non-service callers.
    if (!isServiceCall) {
      if (userId && userId !== callerUserId) {
        log("Forbidden — user tried to send push to another user", { callerUserId, requestedUserId: userId });
        return new Response(
          JSON.stringify({ error: "You can only send push notifications to your own devices" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      userId = callerUserId!;
      explicitTokens = undefined; // ignore any explicit tokens[] from user callers
    }

    // Resolve tokens: explicit list (service role only) OR fetch from DB by userId
    let tokens: string[] = [];
    if (Array.isArray(explicitTokens) && explicitTokens.length > 0) {
      tokens = explicitTokens.filter(
        (t): t is string => typeof t === "string" && t.startsWith("ExponentPushToken"),
      );
    } else if (userId) {
      const { data: rows, error: fetchErr } = await supabaseAdmin
        .from("user_push_tokens")
        .select("expo_push_token")
        .eq("user_id", userId);
      if (fetchErr) {
        log("DB fetch error", { error: fetchErr.message });
      }
      tokens = (rows ?? [])
        .map((r: { expo_push_token: string }) => r.expo_push_token)
        .filter((t): t is string => typeof t === "string" && t.startsWith("ExponentPushToken"));
    }

    log("Tokens resolved", { count: tokens.length });

    if (tokens.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, message: "No registered push tokens for this user" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Session 170 — SERVER-SIDE NOTIFICATION PREFERENCE ENFORCEMENT.
    // Turning a category off in the app must actually block delivery,
    // not just hide client-side. We look up the recipient's notif_prefs
    // JSONB on user_profiles and drop the push if the master toggle is
    // off, if the requested notification type is disabled, or if AI
    // signals are disabled for this user. If notif_prefs is missing we
    // default to enabled for backwards compatibility.
    const notifType = String((data ?? {})?.type ?? '');
    // Determine which users to filter by. For user-scoped calls we
    // already have callerUserId; for service calls we use the body userId.
    const filterUserId = isServiceCall ? (userId ?? null) : callerUserId;
    if (filterUserId) {
      try {
        const { data: profileRow } = await supabaseAdmin
          .from('user_profiles')
          .select('notif_prefs')
          .eq('id', filterUserId)
          .maybeSingle();
        const prefs = (profileRow?.notif_prefs ?? null) as any;
        if (prefs && typeof prefs === 'object') {
          if (prefs.enabled === false) {
            log('Push blocked — user disabled notifications');
            return new Response(
              JSON.stringify({ sent: 0, blocked: true, reason: 'notifications_disabled' }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          const typeToPref: Record<string, string> = {
            ai_signal: 'aiSignals',
            ai_reminder: 'aiSignals',
            breakout: 'aiSignals',
            price_alert: 'priceMovements',
            daily_summary: 'dailySummary',
            market_open: 'marketOpen',
            market_close: 'marketOpen',
          };
          const prefKey = typeToPref[notifType];
          if (prefKey && prefs[prefKey] === false) {
            log(`Push blocked — user disabled ${prefKey}`);
            return new Response(
              JSON.stringify({ sent: 0, blocked: true, reason: `${prefKey}_disabled` }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }
      } catch (e) {
        log('Preference lookup failed — proceeding with default (enabled)', { error: String(e) });
      }
    }

    // Route to the correct Android channel based on notification type so users
    // get the appropriate importance/vibration pattern configured client-side.
    const channelId =
      data?.type === "ai_signal" || data?.type === "ai_reminder" || data?.type === "breakout" ? "ai-signals" :
      data?.type === "daily_summary" ? "daily-summary" :
      data?.type === "market_open" || data?.type === "market_close" ? "market-open" :
      "price-alerts";

    const messages = tokens.map((to) => ({
      to,
      title,
      body: msgBody,
      data: data ?? {},
      sound,
      badge,
      priority: "high",
      channelId,
      _displayInForeground: true,
    }));

    // Expo Push Service accepts up to 100 messages per request.
    const chunks: unknown[][] = [];
    for (let i = 0; i < messages.length; i += 100) {
      chunks.push(messages.slice(i, i + 100));
    }

    let sent = 0;
    const failures: unknown[] = [];
    const invalidTokens: string[] = [];

    for (const chunk of chunks) {
      try {
        const res = await fetch(EXPO_PUSH_API, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Accept-encoding": "gzip, deflate",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(chunk),
        });
        const respJson = await res.json().catch(() => null);
        if (respJson?.data && Array.isArray(respJson.data)) {
          respJson.data.forEach((r: { status?: string; message?: string; details?: { error?: string } }, idx: number) => {
            const item: any = chunk[idx];
            if (r.status === "ok") {
              sent++;
            } else if (r.status === "error") {
              failures.push({ token: item?.to, error: r.message, details: r.details });
              if (r.details?.error === "DeviceNotRegistered") {
                invalidTokens.push(item?.to);
              }
            }
          });
        } else if (respJson?.errors) {
          failures.push({ error: JSON.stringify(respJson.errors) });
        } else if (!res.ok) {
          failures.push({ error: `HTTP ${res.status}` });
        }
      } catch (e) {
        failures.push({ error: String(e) });
      }
    }

    // Remove invalidated tokens so we don't keep hitting Expo Push Service
    // with dead endpoints (rate-limited if we do).
    if (invalidTokens.length > 0) {
      try {
        await supabaseAdmin
          .from("user_push_tokens")
          .delete()
          .in("expo_push_token", invalidTokens);
        log("Removed invalid tokens", { count: invalidTokens.length });
      } catch (e) {
        log("Failed to remove invalid tokens", { error: String(e) });
      }
    }

    log("Send complete", { sent, total: tokens.length, failures: failures.length });

    return new Response(
      JSON.stringify({
        sent,
        total: tokens.length,
        failures,
        invalidTokensRemoved: invalidTokens.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("Error", { message: msg });
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
