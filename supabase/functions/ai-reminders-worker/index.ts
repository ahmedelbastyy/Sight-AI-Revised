// =============================================================================
// Session 191 — ai-reminders-worker is DISABLED.
//
// AI Moves reminders are now delivered as LOCAL scheduled notifications
// from the mobile client (see
// services/notificationService.scheduleAIMovesReminders). Local scheduling
// covers the AI Moves reminder use-case completely — 3 reminders per U.S.
// trading day, generated once per date and persisted so the user's
// reminders remain stable across app launches. iOS delivers those
// scheduled DATE-trigger notifications even while Sight is completely
// closed.
//
// Running this server-side worker ALONGSIDE the local scheduler produced
// duplicate deliveries every time a user foregrounded the app (once from
// this worker's Expo Push and once from the locally-scheduled notification
// that fired on the same schedule). To eliminate that duplicate delivery
// this worker is a no-op — it returns a 200 with status "disabled" and
// does not send a single push.
//
// The ai_reminder_schedule table is intentionally NOT dropped so any
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
      reason: 'ai_moves_now_uses_local_scheduling',
      message: 'AI Moves reminders are delivered as local scheduled notifications from the mobile client. This server worker no longer sends pushes to avoid duplicate delivery.',
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
});
