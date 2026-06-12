import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveModules } from '@/lib/modules';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';
import { sendTaskSlack } from '@/lib/slackNotifications';
import { getWorkspaceMembers, type WorkspaceMemberLookup } from '@/lib/getWorkspaceMemberByAssignee';
import { getSlackCredentials } from '@/lib/getIntegration';
import { createGoogleTaskForMember } from '@/lib/googleTasks';

interface DonorNote {
  id: string;
  workspace_id: string;
  constituent_name: string;
  constituent_id: string | null;
  note: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// Maps a synthetic constituent_name prefix to the `tasks.source` value
// used for routing the auto-created task into the right Tasks-view
// section ("From Development" / "From Admissions") plus the human-
// readable label embedded in the task title. The "Admissions: …"
// prefix is set by the admissions drilldown panel in Dashboard.tsx,
// and "Cooper: …" / "Israel: …" by the Cooper/Israel Development tabs.
// Anything else falls back to development.
function getSourceFromConstituent(constituentName: string): { source: string; label: string } {
  if (constituentName.startsWith('Admissions: ')) return { source: 'admissions', label: 'Admissions' };
  if (constituentName.startsWith('Cooper: ')) return { source: 'development', label: 'Cooper Fund' };
  if (constituentName.startsWith('Israel: ')) return { source: 'development', label: 'Israel Fund' };
  return { source: 'development', label: 'Development' };
}

// Mentionable users are now loaded from workspace_members (those with
// non-null assignee_key). The client UI at DonorAnnotations.tsx still has
// its own list of @-names; the client side will be migrated in Phase B.
// For the server side, parseMentions scans the note text for any
// @<assignee_key> matching a member and returns the matched members.
function parseMentions(text: string, members: WorkspaceMemberLookup[]): WorkspaceMemberLookup[] {
  const names = members.map(m => m.assignee_key).filter((k): k is string => !!k);
  if (names.length === 0) return [];
  const re = new RegExp(`@(${names.join('|')})(?![A-Za-z0-9])`, 'g');
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) found.add(m[1]);
  return members.filter(u => u.assignee_key && found.has(u.assignee_key));
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
    console.error('[DONOR NOTES] Slack DM failed:', err);
  }
}

// Best-effort author display name. Matches against workspace members by
// email; falls back to the email's local-part if no match.
function authorDisplay(email: string, members: WorkspaceMemberLookup[]): string {
  const u = members.find(m => m.email.toLowerCase() === email.toLowerCase());
  if (u?.display_name) return u.display_name;
  return email.split('@')[0] || email;
}

async function getEffectiveWs() {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const wsId = await getEffectiveWorkspaceId(session) || session.workspaceId;
  try {
    const { data: ws } = await supabaseAdmin
      .from('workspaces')
      .select('modules')
      .eq('id', wsId)
      .single();
    if (ws?.modules?.development === false) {
      return { error: NextResponse.json({ error: 'Module not enabled' }, { status: 403 }) };
    }
    const effective = getEffectiveModules(ws?.modules || null, session.allowedModules || null);
    if (effective && effective.development === false) {
      return { error: NextResponse.json({ error: 'Module not enabled for user' }, { status: 403 }) };
    }
  } catch { /* fail open */ }
  return { wsId, email: session.user.email };
}

export async function GET(request: NextRequest) {
  const ctx = await getEffectiveWs();
  if ('error' in ctx) return ctx.error;

  const url = new URL(request.url);
  const constituentName = url.searchParams.get('constituent_name');

  let q = supabaseAdmin
    .from('donor_notes')
    .select('*')
    .eq('workspace_id', ctx.wsId)
    .order('created_at', { ascending: false });
  if (constituentName) q = q.eq('constituent_name', constituentName);

  const { data, error } = await q;
  if (error) {
    console.error('[DONOR NOTES] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load notes' }, { status: 500 });
  }

  // Enrich each note with the author's display_name from workspace_members.
  // The note row only stores `created_by` (email); the client renders that
  // raw if no name is found, but a friendly name is preferred. One query
  // for all unique authors in the batch keeps this O(1) extra work.
  const notes = (data ?? []) as DonorNote[];
  const uniqueAuthors = [...new Set(notes.map(n => n.created_by).filter(Boolean))];
  const displayNameByEmail = new Map<string, string>();
  if (uniqueAuthors.length > 0) {
    const { data: memberRows } = await supabaseAdmin
      .from('workspace_members')
      .select('email, display_name')
      .eq('workspace_id', ctx.wsId)
      .in('email', uniqueAuthors);
    for (const m of (memberRows ?? []) as Array<{ email: string; display_name: string | null }>) {
      if (m.display_name) displayNameByEmail.set(m.email.toLowerCase(), m.display_name);
    }
  }
  const enriched = notes.map(n => ({
    ...n,
    author_name: displayNameByEmail.get((n.created_by || '').toLowerCase()) ?? n.created_by,
  }));

  return NextResponse.json({ notes: enriched });
}

export async function POST(request: NextRequest) {
  const ctx = await getEffectiveWs();
  if ('error' in ctx) return ctx.error;

  let body: { constituent_name?: string; constituent_id?: string | null; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.constituent_name || !body.note?.trim()) {
    return NextResponse.json({ error: 'constituent_name and note required' }, { status: 400 });
  }

  const noteText = body.note.trim();

  const { data, error } = await supabaseAdmin
    .from('donor_notes')
    .insert({
      workspace_id: ctx.wsId,
      constituent_name: body.constituent_name,
      constituent_id: body.constituent_id ?? null,
      note: noteText,
      created_by: ctx.email,
    })
    .select()
    .single();

  if (error) {
    console.error('[DONOR NOTES] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create note' }, { status: 500 });
  }

  // Side effects: Slack DMs to anyone @mentioned + task auto-creation for
  // each mentioned user. Failures here must not roll back the note — fire
  // and forget. Members loaded once for the request.
  const members = await getWorkspaceMembers(ctx.wsId);
  const mentioned = parseMentions(noteText, members);
  const author = authorDisplay(ctx.email, members);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rbk-cmd-center.web.app';
  // Guardian Circle is now a tab inside the Development page — DevelopmentPage
  // reads ?tab= on mount to deep-link from Slack DMs straight to that tab.
  const link = `${appUrl}/?nav=development&tab=guardian-circle`;

  for (const u of mentioned) {
    if (!u.slack_user_id) continue;
    const dm =
      `:clipboard: *Donor Note* — you were mentioned by ${author}\n\n` +
      `*Donor:* ${body.constituent_name}\n` +
      `*Note:* ${noteText}\n\n` +
      `View in Command Center → ${link}`;
    void sendSlackDM(ctx.wsId, u.slack_user_id, dm);
  }

  // Auto-task creation: every @mentioned user with a non-null assignee_key
  // gets a task row. The earlier owner-role gate was reverted — Emily,
  // Sara, and Leora need formal task rows too, not just the mention DM.
  // Members without an assignee_key (rare; only happens if a new workspace
  // member hasn't been onboarded with a Tasks-column key yet) get the
  // Slack DM above but no task row, since `tasks.assigned_to` requires
  // a recognized Capitalized key.
  if (mentioned.length > 0) {
    // Pull google_tasks_refresh_token for every mentioned member up front
    // — one targeted query rather than a per-user lookup inside the loop.
    // Members who haven't connected get null and we skip the Google Tasks
    // push for them (Command Center task row + Slack DM still fire).
    const mentionedIds = mentioned.map(m => m.id);
    const { data: tokenRows } = await supabaseAdmin
      .from('workspace_members')
      .select('id, google_tasks_refresh_token')
      .in('id', mentionedIds);
    const tokenById = new Map<string, string>();
    for (const r of (tokenRows ?? []) as Array<{ id: string; google_tasks_refresh_token: string | null }>) {
      if (r.google_tasks_refresh_token) tokenById.set(r.id, r.google_tasks_refresh_token);
    }

    const { source: taskSource, label: taskLabel } = getSourceFromConstituent(body.constituent_name);
    const titleBase = noteText.length > 80 ? `${noteText.slice(0, 80)}...` : noteText;
    for (const user of mentioned) {
      if (!user.assignee_key) continue;
      const taskTitle = `[${taskLabel}] ${body.constituent_name} — ${titleBase}`;
      const { error: taskErr } = await supabaseAdmin.from('tasks').insert({
        workspace_id: ctx.wsId,
        title: taskTitle,
        source: taskSource,
        source_ref: body.constituent_name,
        assigned_to: user.assignee_key, // 'RBK' | 'Emily' | 'Sara' | 'Leora' | 'Becca' | …
        status: 'todo',
        priority: 'medium',
      });
      if (taskErr) {
        console.error('[DONOR NOTES] Auto-task insert failed for', user.assignee_key, ':', taskErr);
      } else {
        void sendTaskSlack(ctx.wsId, user.assignee_key, { title: taskTitle, source: taskSource });
      }

      // Best-effort push to the assignee's Google Tasks list. Failures
      // are logged inside the helper but never propagate — the Command
      // Center task above is the source of truth.
      const refreshToken = tokenById.get(user.id);
      if (refreshToken) {
        void createGoogleTaskForMember({
          refreshToken,
          title: taskTitle,
          notes: `From RBK Command Center — donor note on ${body.constituent_name}`,
        });
      }
    }
  }

  return NextResponse.json({ note: data as DonorNote }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const ctx = await getEffectiveWs();
  if ('error' in ctx) return ctx.error;

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('donor_notes')
    .delete()
    .eq('id', id)
    .eq('workspace_id', ctx.wsId);

  if (error) {
    console.error('[DONOR NOTES] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
