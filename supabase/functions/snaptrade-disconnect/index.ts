// snaptrade-disconnect (Session 151 — full user deletion)
// =============================================================================
// The user's "Disconnect" action now COMPLETELY removes the customer from
// SnapTrade — not just each brokerage authorization. Per SnapTrade's docs
// this triggers the USER_DELETED webhook and permanently erases the user's
// data on their side, so no orphaned SnapTrade user is left behind.
//
// Strategy:
//   1. Enumerate the user's active brokerage authorizations and remove each.
//      (Belt-and-braces — deleteSnapTradeUser also removes them, but this
//      ensures partial cleanup succeeds even if user-deletion fails.)
//   2. Call authentication.deleteSnapTradeUser to fully erase the SnapTrade
//      user + userSecret on SnapTrade's side.
//   3. Clear the user_broker_connections row on our side — including the
//      stored userSecret — so a future connect fetches a fresh user.
//   4. If any SnapTrade call fails, we STILL clear our local record so
//      Sight can never show a stale "Connected" state after Disconnect.
// =============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  getSnapTradeClient,
  hasSnapTradeCredentials,
  extractSDKError,
} from "../_shared/snaptrade.ts";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    console.log("[SnapTrade Disconnect] request received");
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    const { data: userData, error: authErr } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (authErr || !user) return json(401, { success: false, error: "NOT_AUTHENTICATED" });
    console.log("[SnapTrade Disconnect] user", user.id);

    const body = await req.json().catch(() => ({}));
    const specificAuthorizationId: string | undefined = body?.authorizationId;

    const { data: conn, error: readErr } = await admin
      .from("user_broker_connections")
      .select("snaptrade_user_secret")
      .eq("user_id", user.id)
      .maybeSingle();
    if (readErr) return json(500, { success: false, error: "DB_LOOKUP_FAILED", message: readErr.message });

    const removed: string[] = [];
    const failed: Array<{ id: string; message: string; code?: string | number }> = [];
    let userDeleted = false;
    let userDeletionError: { message: string; code?: string | number } | null = null;

    if (conn?.snaptrade_user_secret && hasSnapTradeCredentials()) {
      try {
        const snaptrade = getSnapTradeClient();

        // 1. List and remove per-connection authorizations first. This is a
        //    belt-and-braces step — deleteSnapTradeUser below removes them
        //    anyway, but doing them individually gives us clean logging
        //    and preserves partial cleanup if deleteSnapTradeUser fails.
        let authIds: string[] = [];
        if (specificAuthorizationId) {
          authIds = [specificAuthorizationId];
        } else {
          try {
            const list = await snaptrade.connections.listBrokerageAuthorizations({
              userId: user.id, userSecret: conn.snaptrade_user_secret,
            } as any);
            const arr = Array.isArray(list.data) ? list.data : [];
            authIds = arr.map((a: any) => a?.id).filter(Boolean);
          } catch (e) {
            const info = extractSDKError(e);
            console.warn("[SnapTrade Disconnect] listBrokerageAuthorizations failed", info);
          }
        }
        console.log(`[SnapTrade Disconnect] removing ${authIds.length} authorization(s)`);

        for (const authorizationId of authIds) {
          try {
            await snaptrade.connections.removeBrokerageAuthorization({
              userId: user.id,
              userSecret: conn.snaptrade_user_secret,
              authorizationId,
            } as any);
            removed.push(authorizationId);
          } catch (e) {
            const info = extractSDKError(e);
            console.warn(`[SnapTrade Disconnect] removeBrokerageAuthorization(${authorizationId}) failed`, info);
            failed.push({ id: authorizationId, message: info.message, code: info.code ?? undefined });
          }
        }

        // 2. Fully delete the SnapTrade USER. This is the definitive
        //    disconnect — SnapTrade fires USER_DELETED and permanently
        //    removes the user, all connections, and the userSecret on
        //    their side. Only skipped when the caller requested a
        //    specific-authorization disconnect (which is not the default).
        if (!specificAuthorizationId) {
          try {
            await snaptrade.authentication.deleteSnapTradeUser({ userId: user.id } as any);
            userDeleted = true;
            console.log("[SnapTrade Disconnect] SnapTrade user deleted");
          } catch (e) {
            const info = extractSDKError(e);
            userDeletionError = { message: info.message, code: info.code ?? undefined };
            console.warn("[SnapTrade Disconnect] deleteSnapTradeUser failed (continuing to DB cleanup)", info);
          }
        }
      } catch (e) {
        const info = extractSDKError(e);
        console.warn("[SnapTrade Disconnect] SDK error (continuing to DB cleanup)", info);
      }
    }

    // 3. DB cleanup — always clear local state so Sight cannot show a stale
    //    "Connected" status. For a FULL disconnect we DELETE the local row
    //    entirely, which drops the stored userSecret. This is the safe
    //    counterpart to deleteSnapTradeUser: the next connect will register
    //    a fresh SnapTrade user rather than trying to reuse a now-invalid
    //    userId/userSecret pair. For partial (specific-authorization)
    //    disconnects we retain the row but blank the snapshots.
    const isFullDisconnect = !specificAuthorizationId;
    if (isFullDisconnect) {
      const { error: delErr } = await admin
        .from("user_broker_connections")
        .delete()
        .eq("user_id", user.id);
      if (delErr) {
        console.warn("[SnapTrade Disconnect] delete row failed, falling back to update", delErr);
        const { error: upErr } = await admin
          .from("user_broker_connections")
          .update({
            status: "disconnected",
            accounts_snapshot: [],
            positions_snapshot: [],
            balances_snapshot: {},
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user.id);
        if (upErr) return json(500, { success: false, error: "DB_WRITE_FAILED", message: upErr.message });
      }
    } else {
      const { error: upErr } = await admin
        .from("user_broker_connections")
        .update({
          status: "disconnected",
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);
      if (upErr) return json(500, { success: false, error: "DB_WRITE_FAILED", message: upErr.message });
    }

    console.log("[SnapTrade Disconnect] success", { removed: removed.length, failed: failed.length, userDeleted });
    return json(200, { success: true, removed, failed, userDeleted, userDeletionError });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[SnapTrade Disconnect] unhandled", msg);
    return json(500, { success: false, error: "INTERNAL_ERROR", message: msg });
  }
});
