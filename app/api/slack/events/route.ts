// Slack Events webhook — receives all incoming events from the Buzz
// Slack app. Three job paths:
//
//   1. url_verification — Slack's initial endpoint handshake when Becca
//      configures the Request URL in api.slack.com/apps.
//   2. DM to the bot with onboarding incomplete — capture the reply,
//      summarize with Claude, persist to user_briefing_preferences,
//      and DM the saved-confirmation (or log it in DRY_RUN).
//   3. DM to the bot with onboarding complete — Phase 2 stub: ack
//      with a placeholder reply (logged in DRY_RUN) and store the
//      message for future Phase 2 conversational features.
//
// MANUAL SLACK APP SETUP (one-time):
//   In api.slack.com/apps → Event Subscriptions:
//     - Enable Events
//     - Request URL: https://ssrrbkcmdcenter-429508710310.us-east1.run.app/api/slack/events
//     - Subscribe to bot events: message.im
//     - Save and reinstall the app if Slack prompts.
//
//   In Slack credentials (workspace_integrations.slack.credentials):
//     - botToken (already present, used to send DMs)
//     - signingSecret (new — used by this route to verify request
//       authenticity; if missing, we log a warning and continue
//       unverified for the initial rollout)
//
// This route is excluded from the middleware auth matcher (see
// middleware.ts) so Slack can POST without a Firebase session cookie.

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { getIntegration } from '@/lib/getIntegration';
import {
  BOT_EMOJI,
  ONBOARDING_SAVED_MESSAGE,
  firstNameOf,
} from '@/lib/buzzBot';
import { DRY_RUN, summarizeOnboardingReply } from '@/lib/morningBriefing';
import { handleConversationalMessage } from '@/lib/buzzConversation';

const SAR_WORKSPACE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

// Slack occasionally redelivers the same event (its 3s ack window means
// a slow handler can trigger a retry). De-dupe by `event_id` with a
// bounded in-memory ring; the runtime resets on cold start, which is
// fine — Slack won't retry past the first few minutes anyway.
const processedEventIds = new Set<string>();

interface SlackEventPayload {
  type?: 'url_verification' | 'event_callback';
  challenge?: string;
  event_id?: string;
  event?: {
    type?: string;
    channel_type?: string;
    bot_id?: string;
    user?: string;
    text?: string;
    ts?: string;
  };
}

// Slack request signature verification per
// https://api.slack.com/authentication/verifying-requests-from-slack.
// Returns true if signature matches (or if signingSecret missing —
// we degrade to unverified with a warning so the initial rollout
// works before Becca uploads the secret).
function verifySlackSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  signingSecret: string,
): boolean {
  if (!signature || !timestamp) return false;
  // Reject anything older than 5 minutes (replay protection)
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > 60 * 5) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = 'v0=' + crypto.createHmac('sha256', signingSecret).update(base).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function sendSlackDM(args: { botToken: string; channel: string; text: string }): Promise<void> {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${args.botToken}`,
    },
    body: JSON.stringify({ channel: args.channel, text: args.text, mrkdwn: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body as { ok?: boolean }).ok !== true) {
    console.warn('[BUZZ EVENTS] Slack postMessage non-ok:', res.status, JSON.stringify(body).slice(0, 300));
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-slack-signature');
  const timestamp = request.headers.get('x-slack-request-timestamp');

  // Look up signingSecret from Slack credentials. If absent (initial
  // rollout state), log a warning but don't 401 — Slack's URL
  // verification handshake doesn't strictly require it.
  // TODO: tighten to hard-fail once signingSecret is uploaded.
  const slack = await getIntegration(SAR_WORKSPACE_ID, 'slack');
  const signingSecret = slack?.signingSecret || process.env.SLACK_SIGNING_SECRET || '';
  if (signingSecret) {
    const ok = verifySlackSignature(rawBody, signature, timestamp, signingSecret);
    if (!ok) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  } else {
    console.warn('[BUZZ EVENTS] No signingSecret configured — proceeding unverified (TODO: tighten after upload)');
  }

  let payload: SlackEventPayload;
  try {
    payload = JSON.parse(rawBody) as SlackEventPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventId = payload.event_id;
  if (eventId) {
    if (processedEventIds.has(eventId)) {
      return NextResponse.json({ ok: true });
    }
    processedEventIds.add(eventId);
    if (processedEventIds.size > 100) {
      const first = processedEventIds.values().next().value;
      if (first !== undefined) processedEventIds.delete(first);
    }
  }

  // 1. URL verification handshake
  if (payload.type === 'url_verification' && payload.challenge) {
    return NextResponse.json({ challenge: payload.challenge });
  }

  // 2. Message events from DMs only — ignore bot's own messages
  const ev = payload.event;
  if (!ev || ev.type !== 'message' || ev.channel_type !== 'im' || ev.bot_id) {
    return NextResponse.json({ ok: true });
  }

  const userSlackId = ev.user;
  const messageText = (ev.text || '').trim();
  if (!userSlackId || !messageText) {
    return NextResponse.json({ ok: true });
  }

  // Look up the member by slack_user_id. Pull the extra fields the
  // conversational handler needs (role, title, allowed_modules) so we
  // don't double-query downstream.
  const { data: member } = await supabaseAdmin
    .from('workspace_members')
    .select('id, email, display_name, slack_user_id, workspace_id, role, title, allowed_modules')
    .eq('slack_user_id', userSlackId)
    .eq('workspace_id', SAR_WORKSPACE_ID)
    .maybeSingle();

  if (!member) {
    // Unknown sender — ignore quietly (don't 4xx, Slack would retry)
    return NextResponse.json({ ok: true });
  }

  // Fire-and-forget processing AFTER returning 200 to Slack.
  // Slack expects sub-3s responses; spawn an async task without
  // awaiting it from the request handler.
  void handleIncomingMessage(
    member as {
      id: string; email: string; display_name: string | null; slack_user_id: string;
      role: string; title: string | null; allowed_modules: Record<string, unknown> | null;
    },
    messageText,
  );
  return NextResponse.json({ ok: true });
}

async function handleIncomingMessage(
  member: {
    id: string; email: string; display_name: string | null; slack_user_id: string;
    role: string; title: string | null; allowed_modules: Record<string, unknown> | null;
  },
  messageText: string,
): Promise<void> {
  try {
    const slack = await getIntegration(SAR_WORKSPACE_ID, 'slack');
    const botToken = slack?.botToken || process.env.SLACK_BOT_TOKEN || '';
    const anthropic = await getIntegration(SAR_WORKSPACE_ID, 'anthropic');
    const anthropicKey = anthropic?.apiKey || process.env.ANTHROPIC_API_KEY || '';
    const firstName = firstNameOf(member.display_name, member.email);

    // Onboarding state check
    const { data: prefRow } = await supabaseAdmin
      .from('user_briefing_preferences')
      .select('email, onboarding_complete')
      .eq('workspace_id', SAR_WORKSPACE_ID)
      .eq('email', member.email)
      .maybeSingle();

    if (!prefRow || !prefRow.onboarding_complete) {
      // Onboarding reply path — summarize and save
      let summary = '';
      try {
        if (anthropicKey) summary = await summarizeOnboardingReply(anthropicKey, messageText);
      } catch (err) {
        console.warn('[BUZZ EVENTS] Claude summarize failed:', err);
      }

      const now = new Date().toISOString();
      if (!prefRow) {
        await supabaseAdmin
          .from('user_briefing_preferences')
          .insert({
            workspace_id: SAR_WORKSPACE_ID,
            email: member.email,
            raw_preference: messageText,
            preferences_summary: summary || messageText,
            onboarding_complete: true,
            updated_at: now,
          });
      } else {
        await supabaseAdmin
          .from('user_briefing_preferences')
          .update({
            raw_preference: messageText,
            preferences_summary: summary || messageText,
            onboarding_complete: true,
            updated_at: now,
          })
          .eq('workspace_id', SAR_WORKSPACE_ID)
          .eq('email', member.email);
      }

      const savedText = ONBOARDING_SAVED_MESSAGE(firstName);
      if (DRY_RUN) {
        console.log('[BUZZ ONBOARDING SAVED - DRY RUN]');
        console.log('To:', member.display_name, '(', member.slack_user_id, ')');
        console.log('Message:\n', savedText);
        console.log('---');
      } else {
        if (botToken) {
          await sendSlackDM({ botToken, channel: member.slack_user_id, text: savedText });
        }
      }
      return;
    }

    // Onboarding complete → Phase 2 conversational Q&A. Hand off to
    // the buzzConversation handler, which builds a permission-scoped
    // context bundle, loads up to 10 prior turns, calls Claude, and
    // DMs the reply (or logs it under DRY_RUN). Special commands
    // ('reset', 'briefing') are handled inside that function.
    console.log('[BUZZ EVENTS] Phase 2 message from', member.email, ':', messageText.slice(0, 200));
    if (!anthropicKey) {
      console.warn('[BUZZ EVENTS] No anthropic key — skipping conversational reply.');
      return;
    }
    await handleConversationalMessage(
      {
        id: member.id,
        email: member.email,
        display_name: member.display_name,
        role: member.role,
        title: member.title,
        slack_user_id: member.slack_user_id,
        allowed_modules: member.allowed_modules,
      },
      messageText,
      SAR_WORKSPACE_ID,
      anthropicKey,
      botToken,
      DRY_RUN,
    );
  } catch (err) {
    console.error('[BUZZ EVENTS] handleIncomingMessage failed for', member.email, err);
  }
  // Reference imported emoji constant so it isn't pruned as unused —
  // logs are easier to find with the bot mark.
  void BOT_EMOJI;
}
