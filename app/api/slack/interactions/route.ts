// POST /api/slack/interactions
//
// Receives Slack interactive-component payloads (block_actions) from the
// @Notify group DM — specifically the "✓ Mark Resolved" button. When a
// tagged member taps it, we mark THEIR notify task done and post a
// "✓ resolved" reply into the thread (mirrors the PATCH /api/tasks resolve
// loop, but here the caller is Slack, not a logged-in session).
//
// The "Open in Command Center" button is a url button — Slack still sends
// an interaction for it, which this route ignores (action_id mismatch).
//
// MANUAL SLACK SETUP (one-time):
//   api.slack.com/apps → your Command Center app → Interactivity & Shortcuts
//     → turn ON
//     → Request URL: https://ssrrbkcmdcenter-429508710310.us-east1.run.app/api/slack/interactions
//     → Save Changes
//   Optionally add SLACK_SIGNING_SECRET to the Cloud Run env to enable
//   request-signature verification (non-fatal until set — see below).
//
// This route is excluded from the middleware auth matcher (see middleware.ts)
// so Slack can POST without a Firebase session cookie.

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { getSlackCredentials } from '@/lib/getIntegration';
import { postSlackMessage } from '@/lib/slackNotifications';

// Verify the request came from Slack via the signing-secret HMAC.
// Non-fatal when SLACK_SIGNING_SECRET is unset: returns true (skip) so the
// endpoint works before the secret is configured — we log a warning at the
// call site. When the secret IS set, an invalid/stale signature returns
// false and the route rejects with 401.
function verifySlackSignature(request: NextRequest, body: string): boolean {
  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET || '';
  if (!slackSigningSecret) return true; // skip verification if not configured

  const timestamp = request.headers.get('x-slack-request-timestamp') || '';
  const slackSignature = request.headers.get('x-slack-signature') || '';

  // Replay guard: reject requests whose timestamp is missing or older than
  // 5 minutes (Slack's own recommendation).
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 60 * 5) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature =
    'v0=' +
    crypto.createHmac('sha256', slackSigningSecret).update(sigBasestring).digest('hex');

  const a = Buffer.from(mySignature);
  const b = Buffer.from(slackSignature);
  // timingSafeEqual throws on unequal lengths — an unequal length is itself
  // a failed match, so short-circuit safely.
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

interface SlackAction {
  action_id?: string;
  value?: string;
}
interface SlackInteractionPayload {
  type?: string;
  user?: { id?: string; name?: string };
  channel?: { id?: string };
  message?: { ts?: string };
  container?: { message_ts?: string };
  actions?: SlackAction[];
}

export async function POST(request: NextRequest) {
  // Read the raw body ONCE — needed both for signature verification (must
  // be the exact bytes Slack signed) and to parse the form payload.
  const rawBody = await request.text();

  if (!process.env.SLACK_SIGNING_SECRET) {
    console.warn(
      '[slack/interactions] SLACK_SIGNING_SECRET not set — skipping signature verification. Add it to secure this endpoint.',
    );
  }
  if (!verifySlackSignature(request, rawBody)) {
    console.warn('[slack/interactions] signature verification failed — rejecting request.');
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  // Slack sends interaction payloads as application/x-www-form-urlencoded
  // with a single `payload` field holding URL-encoded JSON.
  let payload: SlackInteractionPayload;
  try {
    const params = new URLSearchParams(rawBody);
    payload = JSON.parse(params.get('payload') || '') as SlackInteractionPayload;
  } catch (err) {
    console.error('[slack/interactions] failed to parse payload:', err);
    return NextResponse.json({ ok: true }); // ack so Slack doesn't retry
  }

  if (payload.type !== 'block_actions') {
    return NextResponse.json({ ok: true });
  }

  const action = (payload.actions || []).find(a => a.action_id === 'notify_mark_resolved');
  if (!action) {
    // e.g. the "Open in Command Center" url button — nothing to do server-side.
    return NextResponse.json({ ok: true });
  }

  const slackUserId = payload.user?.id || '';
  const channelId = payload.channel?.id || '';
  // The button lives in the group-DM root message, so its ts equals the
  // stored slack_thread_ts. Fall back to container.message_ts / value.
  const threadTs = payload.message?.ts || payload.container?.message_ts || action.value || '';

  try {
    // 1. Resolve the clicking Slack user → workspace member.
    const { data: member } = await supabaseAdmin
      .from('workspace_members')
      .select('id, workspace_id, display_name, email, assignee_key, slack_user_id')
      .eq('slack_user_id', slackUserId)
      .maybeSingle();
    if (!member) {
      console.warn('[slack/interactions] no workspace member for Slack user', slackUserId);
      return NextResponse.json({ ok: true });
    }

    // 2. Find THIS user's open notify task on THIS thread. Matching on the
    //    thread ts (not just channel) is important — Slack reuses the same
    //    MPIM channel id for repeat DMs to the same participant set.
    const assignedCandidates = [member.assignee_key, member.display_name, member.email].filter(
      (v): v is string => !!v,
    );
    let query = supabaseAdmin
      .from('tasks')
      .select('id, assigned_to, title, status, slack_thread_ts, slack_channel_id, workspace_id')
      .eq('workspace_id', member.workspace_id)
      .eq('source', 'notify')
      .neq('status', 'done')
      .in('assigned_to', assignedCandidates)
      .order('created_at', { ascending: false });
    query = threadTs ? query.eq('slack_thread_ts', threadTs) : query.eq('slack_channel_id', channelId);
    const { data: tasks } = await query;

    const task = (tasks || [])[0];
    if (!task) {
      // Clicker is the sender/assistant (no task), or already resolved.
      console.log('[slack/interactions] no open notify task for', member.display_name, 'thread', threadTs);
      return NextResponse.json({ ok: true });
    }

    // 3. Mark it done.
    const nowIso = new Date().toISOString();
    const { error: updErr } = await supabaseAdmin
      .from('tasks')
      .update({ status: 'done', completed_at: nowIso, updated_at: nowIso })
      .eq('id', task.id);
    if (updErr) {
      console.error('[slack/interactions] task update failed:', updErr);
      return NextResponse.json({ ok: true });
    }

    // 4. Post the resolve reply into the thread.
    const { botToken } = await getSlackCredentials(member.workspace_id);
    const ch = task.slack_channel_id || channelId;
    const th = task.slack_thread_ts || threadTs;
    if (botToken && ch && th) {
      const name = member.display_name || member.email?.split('@')[0] || 'Someone';
      await postSlackMessage(ch, botToken, {
        text: `✓ ${name} marked this resolved`,
        thread_ts: th,
      });
    }
  } catch (err) {
    console.error('[slack/interactions] mark-resolved failed:', err);
  }

  return NextResponse.json({ ok: true });
}
