import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

const ADMIN_EMAIL = 'rglassberg@saracademy.org';
// Roles permitted by the workspace_members.role CHECK constraint.
const VALID_ROLES = new Set(['owner', 'assistant', 'viewer']);

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.email.toLowerCase() !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Fetch all workspace members
    const { data: members, error: membersError } = await supabaseAdmin
      .from('workspace_members')
      .select('id, email, display_name, role, workspace_id, allowed_modules, divisions, title, assignee_key, slack_user_id, assistant_to, testing_features')
      .order('display_name', { ascending: true, nullsFirst: false });

    if (membersError) {
      console.error('Admin: members fetch error:', membersError);
      return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
    }

    // Fetch all workspaces for name lookup
    const { data: workspaces, error: wsError } = await supabaseAdmin
      .from('workspaces')
      .select('id, name');

    if (wsError) {
      console.error('Admin: workspaces fetch error:', wsError);
      return NextResponse.json({ error: 'Failed to fetch workspaces' }, { status: 500 });
    }

    const wsMap: Record<string, string> = {};
    for (const ws of workspaces || []) {
      wsMap[ws.id] = ws.name;
    }

    const result = (members || [])
      .map(m => ({
        id: m.id,
        email: m.email,
        display_name: m.display_name,
        role: m.role,
        workspace_id: m.workspace_id,
        workspace_name: wsMap[m.workspace_id] || 'Unknown',
        allowed_modules: m.allowed_modules,
        divisions: m.divisions ?? [],
        title: m.title ?? null,
        assignee_key: m.assignee_key ?? null,
        slack_user_id: m.slack_user_id ?? null,
        assistant_to: m.assistant_to ?? null,
        testing_features: Array.isArray(m.testing_features) ? m.testing_features : [],
      }))
      .sort((a, b) => {
        const nameA = (a.display_name || a.email.split('@')[0]).toLowerCase();
        const nameB = (b.display_name || b.email.split('@')[0]).toLowerCase();
        return nameA.localeCompare(nameB);
      });

    return NextResponse.json({ members: result });
  } catch (error) {
    console.error('Admin: unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Add a new workspace member by email. Uses the PLACEHOLDER user_id
 * convention — the session route at app/api/auth/session/route.ts:91
 * case-insensitively matches by email on first login and swaps in the
 * real Firebase UID. Idempotent on (workspace_id, email): re-adding the
 * same email returns the existing row instead of failing the unique
 * constraint on (workspace_id, user_id).
 */
export async function POST(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.email.toLowerCase() !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: {
    email?: string;
    role?: string;
    workspace_id?: string;
    display_name?: string;
    allowed_modules?: Record<string, boolean> | null;
    divisions?: string[];
    title?: string;
  };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }
  const role = body.role || 'viewer';
  if (!VALID_ROLES.has(role)) {
    return NextResponse.json({ error: `role must be one of: ${[...VALID_ROLES].join(', ')}` }, { status: 400 });
  }

  // Resolve workspace_id: explicit > admin's default workspace.
  let workspaceId = body.workspace_id || session.workspaceId;
  if (!workspaceId) {
    const { data: ws } = await supabaseAdmin
      .from('workspaces')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    workspaceId = ws?.id;
  }
  if (!workspaceId) {
    return NextResponse.json({ error: 'No workspace available' }, { status: 400 });
  }

  // Idempotent: if email already exists in this workspace, return that row.
  const { data: existing } = await supabaseAdmin
    .from('workspace_members')
    .select('id, email, display_name, role, workspace_id, allowed_modules, divisions, title')
    .eq('workspace_id', workspaceId)
    .ilike('email', email)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ member: existing, already_existed: true });
  }

  const placeholderUserId = `PLACEHOLDER-${email}`;
  const insertRow: Record<string, unknown> = {
    workspace_id: workspaceId,
    email,
    user_id: placeholderUserId,
    role,
    display_name: body.display_name?.trim() || null,
    allowed_modules: body.allowed_modules ?? null,
  };
  if (Array.isArray(body.divisions)) insertRow.divisions = body.divisions;
  if (body.title !== undefined) insertRow.title = body.title?.trim() || null;

  const { data, error } = await supabaseAdmin
    .from('workspace_members')
    .insert(insertRow)
    .select('id, email, display_name, role, workspace_id, allowed_modules, divisions, title')
    .single();

  if (error) {
    console.error('Admin: member insert failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ member: data }, { status: 201 });
}
