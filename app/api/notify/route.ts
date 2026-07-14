import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';
import { getSlackCredentials } from '@/lib/getIntegration';
import { openGroupDm, postSlackMessage } from '@/lib/slackNotifications';

// POST /api/notify
//
// Cross-module "@Notify": any authenticated workspace member can tag one
// or more other members, open a Slack group DM to them (plus each tagged
// member's assistant), and drop a task on each tagged member's Command
// Center task list. When a resulting task is later marked done, PATCH
// /api/tasks posts a "✓ resolved" reply back into the Slack thread.
//
// Body: { message: string, context: string, tagged_member_ids: string[] }

interface MemberRow {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  slack_user_id: string | null;
  assignee_key: string | null;
  assistant_to: string | null;
}

const MEMBER_COLS = 'id, email, display_name, role, slack_user_id, assignee_key, assistant_to';

export async function POST(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const wsId = (await getEffectiveWorkspaceId(session)) || session.workspaceId;

  let body: { message?: unknown; context?: unknown; tagged_member_ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const context = typeof body.context === 'string' ? body.context.trim() : '';
  const taggedIds = Array.isArray(body.tagged_member_ids)
    ? body.tagged_member_ids.filter((v): v is string => typeof v === 'string')
    : [];

  if (!message) {
    return NextResponse.json({ error: 'message required' }, { status: 400 });
  }
  if (taggedIds.length === 0) {
    return NextResponse.json({ error: 'at least one tagged member required' }, { status: 400 });
  }

  // Load every member of the workspace once — we need the sender, the
  // tagged members, and each tagged member's assistant (assistant_to = tag.id).
  const { data: allMembers, error: membersErr } = await supabaseAdmin
    .from('workspace_members')
    .select(MEMBER_COLS)
    .eq('workspace_id', wsId);

  if (membersErr) {
    console.error('[notify] failed to load members:', membersErr);
    return NextResponse.json({ error: 'Failed to load members' }, { status: 500 });
  }
  const members = (allMembers ?? []) as MemberRow[];
  const byId = new Map(members.map(m => [m.id, m]));

  const sender = members.find(
    m => m.email.toLowerCase() === session.user!.email!.toLowerCase(),
  );
  if (!sender) {
    return NextResponse.json({ error: 'Sender not a workspace member' }, { status: 403 });
  }

  const tagged = taggedIds.map(id => byId.get(id)).filter((m): m is MemberRow => !!m);
  if (tagged.length === 0) {
    return NextResponse.json({ error: 'No valid tagged members' }, { status: 400 });
  }

  // Assistants of tagged members are added to the group DM only (not
  // task-assigned). "X assists Y" is stored on the assistant's row as
  // assistant_to = Y.id, so find members whose assistant_to is a tagged id.
  const taggedIdSet = new Set(tagged.map(t => t.id));
  const assistants = members.filter(m => m.assistant_to && taggedIdSet.has(m.assistant_to));

  // Build the group-DM participant list: sender + tagged + assistants,
  // deduped by slack_user_id, dropping anyone without a Slack id.
  const participantSlackIds: string[] = [];
  const seenSlack = new Set<string>();
  for (const m of [sender, ...tagged, ...assistants]) {
    const sid = m.slack_user_id;
    if (sid && !seenSlack.has(sid)) {
      seenSlack.add(sid);
      participantSlackIds.push(sid);
    }
  }

  const senderName = sender.display_name || sender.email.split('@')[0] || sender.email;
  const taggedNames = tagged
    .map(t => t.display_name || t.email.split('@')[0] || t.email)
    .join(', ');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rbk-cmd-center.web.app';
  const tasksUrl = `${appUrl}/?nav=tasks`;

  // --- Send the Slack group DM ---
  let slackThreadTs: string | null = null;
  let slackChannelId: string | null = null;
  try {
    const { botToken } = await getSlackCredentials(wsId);
    // Log the full picture up front so Cloud Run shows exactly why a DM
    // did or didn't go out: participant Slack IDs, count, token presence,
    // and who (if anyone) was dropped for having no slack_user_id.
    const missingSlack = [sender, ...tagged, ...assistants]
      .filter(m => !m.slack_user_id)
      .map(m => m.display_name || m.email);
    console.log('[NOTIFY SLACK] preparing group DM', {
      workspaceId: wsId,
      sender: senderName,
      tagged: taggedNames,
      participantSlackIds,
      participantCount: participantSlackIds.length,
      hasBotToken: !!botToken,
      participantsMissingSlackId: missingSlack,
    });

    // Need >= 2 distinct participants for a group DM (Slack rejects a
    // single-user MPIM). If only the sender has a Slack id, skip Slack
    // but still create the tasks.
    if (!botToken) {
      console.error('[NOTIFY SLACK ERROR] no Slack bot token for workspace', wsId, '— skipping group DM (tasks still created)');
    } else if (participantSlackIds.length < 2) {
      console.error('[NOTIFY SLACK ERROR] fewer than 2 participants with a Slack ID — cannot open a group DM (tasks still created)', {
        participantSlackIds,
        participantsMissingSlackId: missingSlack,
      });
    } else {
      const channel = await openGroupDm(participantSlackIds, botToken);
      if (!channel) {
        console.error('[NOTIFY SLACK ERROR] openGroupDm returned null — group DM not opened (see conversations.open log above)', {
          participantSlackIds,
        });
      } else {
        slackChannelId = channel;
        console.log('[NOTIFY SLACK] group DM channel opened:', channel);
        const headline = `*${senderName}* tagged *${taggedNames}* from *${context || 'the Command Center'}*`;
        slackThreadTs = await postSlackMessage(channel, botToken, {
          text: `${senderName} tagged ${taggedNames} from ${context || 'the Command Center'}`,
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `${headline}\n${message}` },
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Open in Command Center', emoji: true },
                  url: tasksUrl,
                  action_id: 'notify_open_command_center',
                },
                {
                  type: 'button',
                  style: 'primary',
                  text: { type: 'plain_text', text: '✓ Mark Resolved', emoji: true },
                  action_id: 'notify_mark_resolved',
                  // Static marker — the interactions route derives the task
                  // from the clicking user + the message's own ts/channel.
                  value: 'mark_resolved',
                },
              ],
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: 'Reply in this thread, or tap *Mark Resolved* when you’ve handled it.',
                },
              ],
            },
          ],
        });
        if (!slackThreadTs) {
          console.error('[NOTIFY SLACK ERROR] postSlackMessage returned null — DM not sent (see chat.postMessage log above)', {
            channel,
          });
        } else {
          console.log('[NOTIFY SLACK] group DM sent, thread ts:', slackThreadTs);
        }
      }
    }
  } catch (err) {
    // Slack is best-effort — never block task creation on a Slack failure.
    console.error('[NOTIFY SLACK ERROR] group DM block threw (non-fatal, tasks still created):', err);
  }

  // --- Create a task for each tagged member (not the sender, not assistants) ---
  const nowIso = new Date().toISOString();
  const taskRows = tagged.map(t => ({
    workspace_id: wsId,
    title: `${senderName} needs your input`,
    description: message,
    // No dedicated context_label column; store the context on source_ref
    // (surfaced as the muted subtitle on sourced-task cards).
    source: 'notify',
    source_ref: context || null,
    // assignee_key when present (RBK/Emily/...), else display_name so the
    // row is still human-identifiable and matchable in the Tasks UI.
    assigned_to: t.assignee_key || t.display_name || t.email,
    priority: 'medium',
    status: 'todo',
    slack_thread_ts: slackThreadTs,
    slack_channel_id: slackChannelId,
    created_at: nowIso,
    updated_at: nowIso,
  }));

  let tasksCreated = 0;
  const { data: insertedTasks, error: taskErr } = await supabaseAdmin
    .from('tasks')
    .insert(taskRows)
    .select('id');
  if (taskErr) {
    console.error('[notify] task insert failed:', taskErr);
  } else {
    tasksCreated = insertedTasks?.length ?? 0;
  }

  return NextResponse.json({
    success: true,
    slack_thread_ts: slackThreadTs,
    tasks_created: tasksCreated,
  });
}
