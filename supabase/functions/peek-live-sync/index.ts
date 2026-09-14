// Supabase Edge Function: peek-live-sync
//
// Deploy: supabase functions deploy peek-live-sync
// No cron entry needed — unlike nightly-rollup, this one is invoked
// directly by the app the instant someone opens Peek (see lib/leagues.ts'
// triggerLeagueLiveSync(), called from app/(app)/leagues/peek.tsx).
//
// What it does: silently wakes every OTHER member of the league (not the
// caller — their own phone is already open and in the foreground looking
// at Peek, so the client syncs their own steps directly instead of over a
// push round-trip) so real steps land in daily_steps before Peek reads
// live standings a few seconds later. Uses the exact same silent
// background-sync push nightly-rollup's presync step already sends (see
// lib/push-notifications.ts) — the client doesn't need to know whether a
// peek or a scheduled reset triggered it, the handling is identical.
//
// supabase.functions.invoke() automatically forwards the caller's own JWT,
// which Supabase's gateway already requires to be valid before this code
// even runs — but that only proves "some signed-in user called this," not
// "this user belongs to this league," so membership is checked here too
// (via is_league_member(), reusing the caller's own JWT) before anything
// is sent. Also rate-limited per caller (via check_rate_limit(), the same
// generic abuse-prevention helper every other write path in this app
// uses) so this can't be hit directly, bypassing the client's own
// use_peek() quota, to spam league-mates with pushes.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { chunk, sendExpoPushMessages, type PushMessage } from '../_shared/push.ts';

Deno.serve(async (req) => {
  let leagueId: string | undefined;
  try {
    const body = await req.json();
    leagueId = typeof body?.leagueId === 'string' ? body.leagueId : undefined;
  } catch {
    // handled by the check below
  }
  if (!leagueId) {
    return new Response(JSON.stringify({ error: 'leagueId is required' }), { status: 400 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  // Scoped to the caller's own JWT — runs as them, so is_league_member()
  // and check_rate_limit() below both apply to their own auth.uid().
  const callerClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser();
  const callerId = userData.user?.id;
  if (userError || !callerId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { data: allowed, error: rateLimitError } = await callerClient.rpc('check_rate_limit', {
    p_action: 'peek_live_sync',
    p_max: 5,
    p_window_seconds: 3600,
  });
  if (rateLimitError || !allowed) {
    return new Response(JSON.stringify({ error: 'Too many live-sync requests — wait a while and try again.' }), {
      status: 429,
    });
  }

  const { data: isMember, error: memberCheckError } = await callerClient.rpc('is_league_member', {
    p_league_id: leagueId,
    p_user_id: callerId,
  });
  if (memberCheckError || !isMember) {
    return new Response(JSON.stringify({ error: 'Not a member of this league.' }), { status: 403 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')! // bypasses RLS — server-only key, never ship this to the app
  );

  const triggeredAt = new Date().toISOString();

  const { data: memberRows, error: membersFetchError } = await supabase
    .from('league_members')
    .select('user_id')
    .eq('league_id', leagueId);
  if (membersFetchError) {
    return new Response(JSON.stringify({ error: membersFetchError.message }), { status: 500 });
  }

  const otherMemberIds = ((memberRows ?? []) as { user_id: string }[])
    .map((r) => r.user_id)
    .filter((id) => id !== callerId);

  let pushesSent = 0;
  for (const idChunk of chunk(otherMemberIds, 500)) {
    const { data: tokenRows, error: tokenError } = await supabase.from('push_tokens').select('token').in('user_id', idChunk);
    if (tokenError) {
      console.error(`push_tokens (peek): ${tokenError.message}`);
      continue;
    }
    const messages: PushMessage[] = ((tokenRows ?? []) as { token: string }[]).map((r) => ({
      to: r.token,
      data: { type: 'background-sync' },
      priority: 'high',
      _contentAvailable: true,
    }));
    await sendExpoPushMessages(messages);
    pushesSent += messages.length;
  }

  return new Response(JSON.stringify({ triggeredAt, memberCount: otherMemberIds.length, pushesSent }), {
    headers: { 'content-type': 'application/json' },
  });
});
