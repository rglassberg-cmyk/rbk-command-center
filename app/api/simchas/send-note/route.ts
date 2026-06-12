import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';
import { sendTaskSlack } from '@/lib/slackNotifications';
import { getMemberByAssigneeKey } from '@/lib/getWorkspaceMemberByAssignee';
import { getSlackCredentials } from '@/lib/getIntegration';

interface Body {
  emailId?: string;
  familyName?: string;
  summary?: string;
  rbkNote?: string;
}

async function sendSlackDM(workspaceId: string, slackUserId: string, text: string): Promise<void> {
  const { botToken: slackToken } = await getSlackCredentials(workspaceId);
  if (!slackToken) return;
  try {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${slackToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: slackUserId, text }),
    });
  } catch (err) {
    console.error('[SIMCHAS SEND NOTE] Slack DM failed:', err);
  }
}

export async function POST(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const wsId = await getEffectiveWorkspaceId(session) || session.workspaceId;

  let body: Body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.familyName) {
    return NextResponse.json({ error: 'familyName required' }, { status: 400 });
  }

  const family = body.familyName.trim();
  const summary = (body.summary || '').trim();
  const rbkNote = (body.rbkNote || '').trim();

  // Composed task body: email summary block + RBK's optional note. Used as
  // both the agenda_notes `text` (so Emily's column shows the full context)
  // and the tasks `description` (so source-tagged consumers get it too).
  const descriptionLines = [
    summary ? `Email summary: ${summary}` : null,
    rbkNote ? `RBK's note: ${rbkNote}` : 'RBK did not add an additional note.',
  ].filter(Boolean);
  const description = descriptionLines.join('\n\n');
  const title = `Draft condolence note — ${family}`;

  // 1) Write to agenda_notes so the existing Emily column in the Tasks view
  //    keeps surfacing this task without any UI changes. We embed the title
  //    + body together so the column item shows the family + context.
  const agendaText = description ? `${title}\n\n${description}` : title;
  const { error: noteErr } = await supabaseAdmin.from('agenda_notes').insert({
    workspace_id: wsId,
    text: agendaText,
    type: 'action',
    assignee: 'Emily',
    email_id: body.emailId ?? null,
  });
  if (noteErr) {
    console.error('[SIMCHAS SEND NOTE] agenda_notes insert failed:', noteErr);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }

  // 2) Mirror into the tasks table with source='simchas' for source-tracked
  //    consumers (sourced-tasks groups, future "From Simchas" rollup).
  //    Failure here doesn't fail the request — agenda_notes is authoritative
  //    for Emily's current workflow.
  const { error: taskErr } = await supabaseAdmin.from('tasks').insert({
    workspace_id: wsId,
    title,
    description,
    source: 'simchas',
    source_ref: family,
    assigned_to: 'Emily',
    status: 'todo',
    priority: 'medium',
  });
  if (taskErr) console.error('[SIMCHAS SEND NOTE] tasks insert failed (non-fatal):', taskErr);

  // Generic "📌 New task assigned to you" DM — fires in addition to the
  // condolence-specific DM below. Per spec, every task-creating route fires
  // sendTaskSlack on creation; Emily gets two DMs per condolence event
  // (one with the specific context, one generic with the task title).
  void sendTaskSlack(wsId, 'Emily', { title, source: 'simchas' });

  // 3) Slack DM Emily — look up her Slack ID from workspace_members rather
  //    than hardcoding it. If the row isn't there or has no slack_user_id,
  //    the condolence-specific DM silently no-ops (the generic
  //    sendTaskSlack above already covers the assignment notification).
  const emilyMember = await getMemberByAssigneeKey(wsId, 'Emily');
  if (emilyMember?.slack_user_id) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rbk-cmd-center.web.app';
    const dm = [
      ':clipboard: *Condolence Note Request*',
      '',
      `*Family:* ${family}`,
      summary ? `*Details:* ${summary}` : null,
      rbkNote ? `*RBK's note:* ${rbkNote}` : '*RBK\'s note:* No additional note',
      '',
      `Open in Command Center → ${appUrl}/?nav=tasks`,
    ].filter(Boolean).join('\n');
    void sendSlackDM(wsId, emilyMember.slack_user_id, dm);
  }

  return NextResponse.json({ success: true });
}
