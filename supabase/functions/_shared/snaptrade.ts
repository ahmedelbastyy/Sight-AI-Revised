// SnapTrade SDK client (Session 199 — defensive credentials hardening)
// =============================================================================
// This module exposes the OFFICIAL snaptrade-typescript-sdk client, so every
// edge function talks to SnapTrade through the vendor's supported wrapper
// rather than hand-rolling HMAC signing. Handles:
//
//   • Commercial API Key initialization (clientId + consumerKey from env only)
//   • Lazy-cached client
//   • Consistent SDK error extraction (works for both axios-style .response
//     errors and the SDK's ResponseError shape)
//   • A hasSnapTradeCredentials() gate for early failure with clean messaging
//   • Session 199: env var TRIMMING — SNAPTRADE_CLIENT_ID and
//     SNAPTRADE_CONSUMER_KEY are stripped of leading / trailing whitespace
//     (including newlines / tabs / CR / LF) before use. This is the direct
//     fix for the "Invalid clientId provided" 1083 error users started
//     seeing last Friday — if the value was ever copy/pasted into the
//     OnSpace Cloud Dashboard with a trailing newline or space, SnapTrade
//     would reject it as an unknown clientId despite the raw string
//     containing the correct partner ID. Trimming makes the environment
//     robust to that class of copy/paste corruption without any user
//     action required.
//   • Session 199: getSnapTradeCredentialsDiagnostic() returns SAFE metadata
//     (lengths, prefix / suffix hash surrogates) for the diagnostic tool so
//     support can verify env correctness without ever exposing the raw
//     credential values.
//
// SECURITY: SNAPTRADE_CLIENT_ID + SNAPTRADE_CONSUMER_KEY live ONLY in Edge
// Function environment variables. This file is never bundled into the iOS or
// Android app. userSecret values are stored ONLY in the database, retrieved
// server-side per request.
// =============================================================================

// Deno-native npm import for the official SDK. Pin the major version to
// avoid surprise breaking changes; 9.x is the current stable line and
// npm resolves the latest patch automatically for security fixes.
import { Snaptrade } from "npm:snaptrade-typescript-sdk@9";

let cachedClient: Snaptrade | null = null;
let cachedCredHash: string | null = null;

// Session 199 — defensive credential normalization. Every callsite MUST
// go through this function to avoid subtle whitespace / newline
// corruption in the OnSpace Cloud Dashboard secret editor.
function readCredential(name: string): string {
  const raw = Deno.env.get(name);
  if (typeof raw !== "string") return "";
  // Strip ALL common whitespace/control characters at both ends. NEVER
  // touch the interior of the string because SnapTrade credentials are
  // opaque strings that might legitimately contain hyphens / underscores
  // / mixed case.
  return raw.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, "");
}

export function hasSnapTradeCredentials(): boolean {
  const clientId = readCredential("SNAPTRADE_CLIENT_ID");
  const consumerKey = readCredential("SNAPTRADE_CONSUMER_KEY");
  return clientId.length > 0 && consumerKey.length > 0;
}

/**
 * Session 199 — safe diagnostic accessor. Returns metadata that reveals
 * whether credentials LOOK reasonable without ever exposing the actual
 * secret values. Used by snaptrade-diagnostic to help support identify
 * env corruption (extra whitespace, empty strings, wrong lengths, etc.).
 */
export function getSnapTradeCredentialsDiagnostic() {
  const rawClient = Deno.env.get("SNAPTRADE_CLIENT_ID") ?? "";
  const rawConsumer = Deno.env.get("SNAPTRADE_CONSUMER_KEY") ?? "";
  const cleanClient = readCredential("SNAPTRADE_CLIENT_ID");
  const cleanConsumer = readCredential("SNAPTRADE_CONSUMER_KEY");
  return {
    clientId: {
      configured: cleanClient.length > 0,
      rawLength: rawClient.length,
      trimmedLength: cleanClient.length,
      hadWhitespace: rawClient.length !== cleanClient.length,
      prefix: cleanClient.length > 0 ? cleanClient.slice(0, 3) : null,
      suffix: cleanClient.length > 4 ? cleanClient.slice(-2) : null,
    },
    consumerKey: {
      configured: cleanConsumer.length > 0,
      rawLength: rawConsumer.length,
      trimmedLength: cleanConsumer.length,
      hadWhitespace: rawConsumer.length !== cleanConsumer.length,
    },
  };
}

/**
 * Returns a cached SnapTrade SDK client. Reads credentials from env every
 * invocation on first use, then caches. Throws if credentials are missing so
 * callers can convert to a 500 with a clean error code.
 *
 * Session 199: cache is keyed on the trimmed credential hash so a secret
 * rotation (e.g. cleaning up whitespace in the Cloud Dashboard) is picked
 * up on the NEXT edge function cold-start — never stuck on a stale client.
 */
export function getSnapTradeClient(): Snaptrade {
  const clientId = readCredential("SNAPTRADE_CLIENT_ID");
  const consumerKey = readCredential("SNAPTRADE_CONSUMER_KEY");
  if (!clientId || !consumerKey) {
    throw new Error("SNAPTRADE_CREDENTIALS_MISSING");
  }
  const credHash = `${clientId.length}:${consumerKey.length}:${clientId.slice(0, 3)}${clientId.slice(-2)}`;
  if (cachedClient && cachedCredHash === credHash) return cachedClient;
  // Log a SAFE fingerprint of the credentials so we can verify from
  // edge function logs that the env is what we expect — never the raw
  // values.
  console.log(
    `[SnapTrade SDK] initialized Commercial API client (clientId.length=${clientId.length}, consumerKey.length=${consumerKey.length})`,
  );
  cachedClient = new Snaptrade({ clientId, consumerKey });
  cachedCredHash = credHash;
  return cachedClient;
}

export interface SnapTradeErrorInfo {
  message: string;
  code: string | number | null;
  status: number;
  operation?: string;
}

/**
 * Extract a useful error shape from anything the SDK throws. The SDK wraps
 * axios errors, so the real SnapTrade error body lives at several possible
 * locations depending on version. We probe them in order.
 */
export function extractSDKError(err: unknown, operation?: string): SnapTradeErrorInfo {
  const anyErr = err as any;
  const status =
    anyErr?.responseBody?.status ??
    anyErr?.response?.status ??
    anyErr?.status ??
    500;
  // The parsed SnapTrade error body — depends on SDK internal shape.
  const body =
    anyErr?.responseBody?.data ??
    anyErr?.responseBody ??
    anyErr?.response?.data ??
    anyErr?.body ??
    {};
  const code =
    (body && typeof body === "object" ? (body.code ?? body.errorCode ?? body.error_code) : null) ?? null;
  const message =
    (body && typeof body === "object" ? (body.detail ?? body.message ?? body.description ?? body.error) : null) ??
    (typeof anyErr?.message === "string" ? anyErr.message : "SnapTrade API error");
  return { message: String(message).slice(0, 500), code, status: Number(status) || 500, operation };
}

/**
 * Heuristic — did SnapTrade reject the request because the userId/userSecret
 * mapping is stale? Used to trigger self-healing (delete + re-register).
 */
export function isCredentialError(info: SnapTradeErrorInfo): boolean {
  if (info.status === 401 || info.status === 403) return true;
  const msg = String(info.message ?? "").toLowerCase();
  if (msg.includes("invalid user")) return true;
  if (msg.includes("usersecret") || msg.includes("user secret")) return true;
  if (msg.includes("not found") && msg.includes("user")) return true;
  const code = String(info.code ?? "");
  if (code === "1076" || code === "0000" || code === "1010") return true;
  return false;
}

/**
 * Session 199 — narrow "invalid clientId" detector. When SnapTrade returns
 * code 1083 (or a message containing "invalid clientId"), the problem is
 * with the PARTNER credentials (clientId / consumerKey), NOT the specific
 * SnapTrade user. Callers should short-circuit any per-user retries and
 * surface a clear operator-actionable error message.
 */
export function isPartnerCredentialError(info: SnapTradeErrorInfo): boolean {
  const code = String(info.code ?? "");
  if (code === "1083") return true;
  const msg = String(info.message ?? "").toLowerCase();
  if (msg.includes("invalid clientid")) return true;
  if (msg.includes("invalid client id")) return true;
  return false;
}
