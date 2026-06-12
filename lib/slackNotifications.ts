// Slack-DM helpers shared across the app.
//
// Three exports:
//   - sendSlackDM(slackUserId, message, botToken): generic DM. Never
//     throws. Used by the grant wire-sent / major gift / absence
//     alert notifiers.
//   - getSlackUserIdByEmail(email, workspaceId, supabase): looks up
//     workspace_members.slack_user_id by email. Returns null when no
//     match (silent caller-side skip).
//   - sendTaskSlack(workspaceId, assignedTo, task, actorEmail?):
//     existing task-assignment DM. The actorEmail param (new 2026-06-09)
//     enables self-assignment skip — if the assignee resolves to the
//     same email as the actor, no DM is sent.
//
// Callers of sendTaskSlack: /api/tasks (POST/PATCH), /api/agenda-notes
// (POST, PATCH), /api/simchas/send-note (POST), /api/development/
// donor-notes (POST when a mention auto-creates a task).
//
// Slack IDs are not hardcoded for task assignments — they live on
// workspace_members.slack_user_id, looked up by assignee_key. Per-user
// hardcoded Slack IDs in other notifiers (RBK, Emily, Sara) are
// intentional because those recipients are role-specific recipients
// regardless of the actor's workspace.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getMemberByAssigneeKey } from './getWorkspaceMemberByAssignee';
import { getSlackCredentials } from './getIntegration';

const SLACK_POST_URL = 'https://slack.com/api/chat.postMessage';

export interface SlackTask {
  title: string;
  source?: string | null;
  due_date?: string | null;
  notes?: string | null;
}

// Generic Slack DM. Bot token is passed in so callers that already
// have it don't double-fetch. Failures are logged + swallowed —
// notifications are best-effort, never block the calling write path.
export async function sendSlackDM(
  slackUserId: string,
  message: string,
  botToken: string,
): Promise<void> {
  if (!slackUserId || !botToken) {
    console.log('[sendSlackDM] missing slackUserId or botToken, skipping');
    return;
  }
  try {
    const res = await fetch(SLACK_POST_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel: slackUserId, text: message, mrkdwn: true }),
    });
    if (!res.ok) {
      console.warn('[sendSlackDM] non-ok response:', res.status);
      return;
    }
    const json = await res.json().catch(() => ({}));
    if ((json as { ok?: boolean }).ok !== true) {
      console.warn('[sendSlackDM] Slack error:', JSON.stringify(json).slice(0, 300));
    }
  } catch (err) {
    console.warn('[sendSlackDM] fetch threw:', err);
  }
}

// Look up a workspace_member's slack_user_id by email. Returns null
// when no match or any error.
export async function getSlackUserIdByEmail(
  email: string,
  workspaceId: string,
  supabase: SupabaseClient,
): Promise<string | null> {
  if (!email || !workspaceId) return null;
  try {
    const { data, error } = await supabase
      .from('workspace_members')
      .select('slack_user_id')
      .eq('workspace_id', workspaceId)
      .ilike('email', email)
      .maybeSingle();
    if (error) {
      console.warn('[getSlackUserIdByEmail] query error:', error.message);
      return null;
    }
    return (data?.slack_user_id as string | undefined) ?? null;
  } catch (err) {
    console.warn('[getSlackUserIdByEmail] threw:', err);
    return null;
  }
}

// Helper: truncate notes/description to ~100 chars for the task DM.
function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export async function sendTaskSlack(
  workspaceId: string,
  assignedTo: string,
  task: SlackTask,
  actorEmail?: string,
): Promise<void> {
  console.log('[sendTaskSlack] called with workspaceId:', workspaceId, 'assignedTo:', assignedTo);
  const member = await getMemberByAssigneeKey(workspaceId, assignedTo);
  console.log('[sendTaskSlack] resolved member:', member ? { id: member.id, slack: member.slack_user_id } : null);

  if (!member?.slack_user_id) {
    console.log('[sendTaskSlack] no slack_user_id found, skipping');
    return;
  }

  // Self-skip: if the assignee resolves to the same email as the
  // actor who initiated the write, don't DM. Comparison is case-
  // insensitive and tolerant of either side being missing.
  if (actorEmail && member.email && member.email.toLowerCase() === actorEmail.toLowerCase()) {
    console.log('[sendTaskSlack] assignee == actor, skipping self-notification');
    return;
  }

  const { botToken: slackToken } = await getSlackCredentials(workspaceId);
  if (!slackToken) {
    console.log('[sendTaskSlack] no Slack bot token configured for workspace, skipping');
    return;
  }

  const notesLine = task.notes && task.notes.trim()
    ? `\n${truncate(task.notes.trim(), 100)}`
    : '';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rbk-cmd-center.web.app';
  const message = `:clipboard: You've been assigned a task:\n*${task.title}*${notesLine}\n→ ${appUrl}`;

  await sendSlackDM(member.slack_user_id, message, slackToken);
}
