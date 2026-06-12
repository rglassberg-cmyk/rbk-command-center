import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getWorkspaceMembers } from '@/lib/getWorkspaceMemberByAssignee';
import { getSlackCredentials } from '@/lib/getIntegration';

// Daily 8am ET sweep, triggered by the `dailyTaskDueReminder` Cloud Function.
// Auth via shared secret (no user session — same pattern as the existing
// sync-gifts-internal endpoint).

interface DueTask {
  id: string;
  title: string;
  workspace_id: string;
  assigned_to: string;
  source: string | null;
  due_date: string;
}

// ET-aware "today" boundaries. due_date is timestamptz so a plain string
// equality check against "2026-05-19" would compare against midnight UTC
// and skip tasks due during ET morning hours. We compute the ET day and
// query the range [start_of_day_ET, start_of_next_day_ET).
function etDayBoundsISO(): { startISO: string; nextISO: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
  const today = fmt.format(new Date());
  const start = new Date(`${today}T00:00:00-04:00`);
  // ET is UTC-4 (EDT) most of the year; UTC-5 (EST) during standard time.
  // Using a fixed -04:00 offset misbehaves in winter, so compute the next
  // day by adding 24h to the *parsed* timestamp instead of string-mangling.
  const next = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startISO: start.toISOString(), nextISO: next.toISOString() };
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-internal-secret');
  const expected = process.env.INTERNAL_SYNC_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { startISO, nextISO } = etDayBoundsISO();

  const { data: tasks, error } = await supabaseAdmin
    .from('tasks')
    .select('id, title, workspace_id, assigned_to, source, due_date')
    .gte('due_date', startISO)
    .lt('due_date', nextISO)
    .not('status', 'eq', 'done')
    .not('status', 'eq', 'completed')
    .not('assigned_to', 'is', null);

  if (error) {
    console.error('[DUE TODAY] Query failed:', error);
    return NextResponse.json({ error: 'Query failed' }, { status: 500 });
  }

  // Build per-workspace (slackToken, assignee_key → slack_user_id) lookup
  // maps by loading members + integration credentials for every workspace
  // that has at least one due task. For typical workloads this is 1
  // workspace; the Set keeps it cheap if tasks span more.
  const dueTasks = (tasks ?? []) as DueTask[];
  const workspaceIds = Array.from(new Set(dueTasks.map(t => t.workspace_id)));
  const slackByKey = new Map<string, string>(); // key: `${wsId}::${assigneeKey.toLowerCase()}`
  const slackTokens = new Map<string, string>(); // wsId → bot token
  for (const wsId of workspaceIds) {
    const [members, creds] = await Promise.all([
      getWorkspaceMembers(wsId),
      getSlackCredentials(wsId),
    ]);
    if (creds.botToken) slackTokens.set(wsId, creds.botToken);
    for (const m of members) {
      if (m.assignee_key && m.slack_user_id) {
        slackByKey.set(`${wsId}::${m.assignee_key.toLowerCase()}`, m.slack_user_id);
      }
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rbk-cmd-center.web.app';
  let sent = 0;

  for (const task of dueTasks) {
    const slackId = slackByKey.get(`${task.workspace_id}::${task.assigned_to.toLowerCase()}`);
    if (!slackId) continue;
    const slackToken = slackTokens.get(task.workspace_id);
    if (!slackToken) continue; // workspace hasn't configured Slack

    const sourceText = task.source && task.source !== 'manual'
      ? `\n*From:* ${task.source}`
      : '';
    const text =
      `:alarm_clock: *Task due today*\n\n` +
      `*${task.title}*${sourceText}\n\n` +
      `View in Command Center → ${appUrl}/?nav=tasks`;

    try {
      await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${slackToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel: slackId, text }),
      });
      sent++;
    } catch (err) {
      console.error('[DUE TODAY] Slack DM failed for', task.id, err);
    }
  }

  return NextResponse.json({ matched: tasks?.length ?? 0, sent });
}
